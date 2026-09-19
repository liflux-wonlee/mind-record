/**
 * Hand-written to match `supabase/migrations/*.sql` exactly, in the same
 * shape the Supabase CLI's `supabase gen types typescript` would produce
 * (including the `Relationships`/`Views`/`Functions` keys postgrest-js's
 * `GenericSchema` constraint requires — leaving them out silently collapses
 * every query's row type to `never`).
 *
 * This project's Supabase project isn't reachable from this environment, so
 * these couldn't be generated automatically. Once you have the Supabase CLI
 * logged into the `mind-record` project, replace this file with the real
 * generated output (and keep it in sync the same way afterwards):
 *
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SessionMode = 'capture' | 'conversation' | 'driving';
export type SessionProcessingStatus = 'pending' | 'transcribing' | 'analyzing' | 'done' | 'error';
/** Full structured breakdown of a recording (see supabase/functions/process-session) -- bullets may contain `**bold**` spans. */
export type SessionOutlineSection = { heading: string; bullets: string[] };
export type MessageRole = 'user' | 'assistant' | 'system';
export type TaskStatus = 'open' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high';
export type AttachmentType = 'audio' | 'image' | 'document';
/** The OpenAI TTS voices the app offers a preview for -- see preview-voice/converse Edge Functions. */
export type AiVoice = 'alloy' | 'echo' | 'onyx' | 'nova' | 'shimmer';

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          timezone: string;
          locale: string;
          /** What the user calls the AI (e.g. "Lina") -- null means no name is set. */
          ai_name: string | null;
          /** How the AI should address the user (e.g. "Won님") -- null means don't use one. */
          user_honorific: string | null;
          ai_voice: AiVoice;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          locale?: string;
          ai_name?: string | null;
          user_honorific?: string | null;
          ai_voice?: AiVoice;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          user_id: string;
          title: string | null;
          mode: SessionMode;
          started_at: string;
          ended_at: string | null;
          raw_transcript: string | null;
          summary: string | null;
          outline: SessionOutlineSection[] | null;
          processing_status: SessionProcessingStatus;
          processing_error: string | null;
          /** AI's best-guess topic for the whole recording when it wasn't confident enough to file it; null once filed. */
          topic_suggestion: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string | null;
          mode: SessionMode;
          started_at?: string;
          ended_at?: string | null;
          topic_suggestion?: string | null;
          raw_transcript?: string | null;
          summary?: string | null;
          outline?: SessionOutlineSection[] | null;
          processing_status?: SessionProcessingStatus;
          processing_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['sessions']['Insert']>;
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          session_id: string;
          user_id: string;
          role: MessageRole;
          content: string;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id: string;
          role: MessageRole;
          content: string;
          // Auto-filled by the set_messages_position trigger when omitted.
          position?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['messages']['Insert']>;
        Relationships: [];
      };
      topics: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          color: string | null;
          parent_topic_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          color?: string | null;
          parent_topic_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['topics']['Insert']>;
        Relationships: [];
      };
      session_topics: {
        Row: {
          session_id: string;
          topic_id: string;
          confidence: number | null;
          created_at: string;
        };
        Insert: {
          session_id: string;
          topic_id: string;
          confidence?: number | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['session_topics']['Insert']>;
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          user_id: string;
          source_session_id: string | null;
          title: string;
          description: string | null;
          status: TaskStatus;
          priority: TaskPriority;
          due_date: string | null;
          completed_at: string | null;
          topic_id: string | null;
          topic_suggestion: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_session_id?: string | null;
          title: string;
          description?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          due_date?: string | null;
          completed_at?: string | null;
          topic_id?: string | null;
          topic_suggestion?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['tasks']['Insert']>;
        Relationships: [];
      };
      memories: {
        Row: {
          id: string;
          user_id: string;
          source_session_id: string | null;
          content: string;
          category: string | null;
          importance: number | null;
          topic_id: string | null;
          topic_suggestion: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_session_id?: string | null;
          content: string;
          category?: string | null;
          importance?: number | null;
          topic_id?: string | null;
          topic_suggestion?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['memories']['Insert']>;
        Relationships: [];
      };
      attachments: {
        Row: {
          id: string;
          user_id: string;
          session_id: string;
          type: AttachmentType;
          file_name: string;
          storage_path: string;
          mime_type: string | null;
          file_size: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id: string;
          type: AttachmentType;
          file_name: string;
          storage_path: string;
          mime_type?: string | null;
          file_size?: number | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['attachments']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      merge_topics: {
        Args: { source_id: string; target_id: string };
        Returns: void;
      };
      assign_session_topic: {
        Args: { p_session_id: string; p_topic_id: string };
        Returns: void;
      };
      search_everything: {
        Args: { q: string; max_results?: number };
        Returns: {
          kind: string;
          id: string;
          title: string;
          snippet: string | null;
          happened_at: string;
          session_id: string | null;
          topic_id: string | null;
        }[];
      };
    };
  };
};
