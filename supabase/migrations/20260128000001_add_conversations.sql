-- Add conversation history tables for chat persistence
-- Supports both anonymous (local-only) and authenticated (server-synced) users

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New conversation',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ, -- Soft delete for recovery
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES messages(id) ON DELETE SET NULL, -- For future branching support
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    attached_data JSONB DEFAULT '{}'::jsonb, -- events, suggestions, directions
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sequence_number INTEGER NOT NULL DEFAULT 0
);

-- Indexes for efficient querying
-- Primary access pattern: list user's conversations ordered by most recent activity
CREATE INDEX idx_conversations_user_updated
    ON conversations(user_id, updated_at DESC)
    WHERE deleted_at IS NULL;

-- For fetching messages in a conversation with cursor-based pagination
CREATE INDEX idx_messages_conversation_cursor
    ON messages(conversation_id, created_at DESC, id DESC);

-- Full-text search on message content
CREATE INDEX idx_messages_content_search
    ON messages USING GIN (to_tsvector('english', content));

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Row Level Security
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Conversations policies: users can only access their own conversations
CREATE POLICY "Users can view their own conversations"
    ON conversations FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own conversations"
    ON conversations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own conversations"
    ON conversations FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own conversations"
    ON conversations FOR DELETE
    USING (auth.uid() = user_id);

-- Messages policies: users can access messages in their conversations
CREATE POLICY "Users can view messages in their conversations"
    ON messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND conversations.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert messages in their conversations"
    ON messages FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND conversations.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update messages in their conversations"
    ON messages FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND conversations.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete messages in their conversations"
    ON messages FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND conversations.user_id = auth.uid()
        )
    );

-- Service role bypass for server-side operations (migration, etc.)
CREATE POLICY "Service role has full access to conversations"
    ON conversations FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role has full access to messages"
    ON messages FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- Comments for documentation
COMMENT ON TABLE conversations IS 'Chat conversation sessions with metadata and soft delete support';
COMMENT ON TABLE messages IS 'Individual messages within conversations, supporting future branching via parent_id';
COMMENT ON COLUMN conversations.deleted_at IS 'Soft delete timestamp - NULL means active, non-NULL means deleted';
COMMENT ON COLUMN messages.parent_id IS 'For future branching/threading support - currently unused';
COMMENT ON COLUMN messages.attached_data IS 'JSONB containing events, suggestions, directions shown with this message';
COMMENT ON COLUMN messages.sequence_number IS 'Order within conversation for deterministic sorting';
