-- Create user_preferences table for personalized recommendations
-- This stores user-provided context to help the AI chatbot make better recommendations

create table user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references auth.users(id) on delete cascade,
  
  -- About the user (free text for AI context)
  -- Example: "I'm an expat living in Palermo, love live jazz and food festivals"
  about_me text,
  
  -- Event interests (categorical, uses existing CATEGORIES enum values)
  -- Valid values: music, arts, food, social, sports, festival
  preferred_categories text[] default '{}',
  
  -- Location preferences (uses neighborhood names from NEIGHBORHOODS constant)
  preferred_neighborhoods text[] default '{}',
  
  -- Metadata
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create index for user lookups
create index idx_user_preferences_user_id on user_preferences(user_id);

-- Enable Row Level Security
alter table user_preferences enable row level security;

-- RLS policies: users can only access their own preferences
create policy "Users can view own preferences" 
  on user_preferences for select 
  using (auth.uid() = user_id);

create policy "Users can insert own preferences" 
  on user_preferences for insert 
  with check (auth.uid() = user_id);

create policy "Users can update own preferences" 
  on user_preferences for update 
  using (auth.uid() = user_id);

create policy "Users can delete own preferences" 
  on user_preferences for delete 
  using (auth.uid() = user_id);

-- Apply the existing updated_at trigger
create trigger user_preferences_updated_at
  before update on user_preferences
  for each row
  execute function update_updated_at();

-- Add comment for documentation
comment on table user_preferences is 'User preferences for personalized event recommendations';
comment on column user_preferences.about_me is 'Free-text description of user interests and context for AI personalization';
comment on column user_preferences.preferred_categories is 'Array of preferred event categories (music, arts, food, social, sports, festival)';
comment on column user_preferences.preferred_neighborhoods is 'Array of preferred Buenos Aires neighborhoods';
