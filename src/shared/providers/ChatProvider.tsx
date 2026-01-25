import { createContext, useContext, useCallback, useRef, type ReactNode } from 'react'

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
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  // Store the handler in a ref so it can be updated without re-renders
  const startNewChatHandlerRef = useRef<(() => void) | null>(null)

  const registerStartNewChatHandler = useCallback((handler: () => void) => {
    startNewChatHandlerRef.current = handler
  }, [])

  const startNewChat = useCallback(() => {
    if (startNewChatHandlerRef.current) {
      startNewChatHandlerRef.current()
    }
  }, [])

  return (
    <ChatContext.Provider value={{ startNewChat, registerStartNewChatHandler }}>
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
