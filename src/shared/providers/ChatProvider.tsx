import { createContext, useContext, useCallback, useRef, useState, type ReactNode } from 'react'

interface ChatContextValue {
  /**
   * Start a new chat session - clears messages and resets state
   */
  startNewChat: () => void
  /**
   * Register the handler that will be called when startNewChat is invoked.
   * This should be called by ChatContainer to register its reset logic.
   */
  registerStartNewChatHandler: (handler: () => void) => void

  // Conversation history state
  /**
   * ID of the currently active conversation (null = new conversation not yet created)
   */
  activeConversationId: string | null
  /**
   * Set the active conversation ID (used when loading a conversation or creating a new one)
   */
  setActiveConversationId: (id: string | null) => void
  /**
   * Whether the conversation sidebar is open
   */
  isSidebarOpen: boolean
  /**
   * Toggle the sidebar open/closed
   */
  toggleSidebar: () => void
  /**
   * Open the sidebar
   */
  openSidebar: () => void
  /**
   * Close the sidebar
   */
  closeSidebar: () => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  // Store the handler in a ref so it can be updated without re-renders
  const startNewChatHandlerRef = useRef<(() => void) | null>(null)

  // Conversation state
  const [activeConversationId, setActiveConversationIdState] = useState<string | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const registerStartNewChatHandler = useCallback((handler: () => void) => {
    startNewChatHandlerRef.current = handler
  }, [])

  const startNewChat = useCallback(() => {
    // Clear active conversation
    setActiveConversationIdState(null)
    // Call the registered handler to clear messages
    if (startNewChatHandlerRef.current) {
      startNewChatHandlerRef.current()
    }
    // Close sidebar on mobile after starting new chat
    setIsSidebarOpen(false)
  }, [])

  const setActiveConversationId = useCallback((id: string | null) => {
    setActiveConversationIdState(id)
  }, [])

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev)
  }, [])

  const openSidebar = useCallback(() => {
    setIsSidebarOpen(true)
  }, [])

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false)
  }, [])

  return (
    <ChatContext.Provider
      value={{
        startNewChat,
        registerStartNewChatHandler,
        activeConversationId,
        setActiveConversationId,
        isSidebarOpen,
        toggleSidebar,
        openSidebar,
        closeSidebar,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export function useChatContext() {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChatContext must be used within a ChatProvider')
  }
  return context
}

/**
 * Safe version of useChatContext that returns null when outside ChatProvider.
 * Use this in components that may be rendered outside the chat context.
 */
export function useChatContextSafe() {
  return useContext(ChatContext)
}
