/**
 * Hand-written to match `supabase/migrations/*.sql` exactly, in the same
 * shape the Supabase CLI's `supabase gen types typescript` would produce
 * (including the `Relationships`/`Views`/`Functions` keys postgrest-js's
 * `GenericSchema` constraint requires — leaving them out silently collapses
 * every query's row type to `never`).
 *
 * This project's Supabase project isn't reachable from this environment, so
 * these couldn't be generated automatically. Once you have the Supabase CLI
 * logged into the JoaAssistant project, replace this file with the real
 * generated output (and keep it in sync the same way afterwards):
 *
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SessionMode = 'capture' | 'conversation' | 'driving' | 'note';
export type SessionProcessingStatus = 'pending' | 'transcribing' | 'analyzing' | 'done' | 'error';
/**
 * Full structured breakdown of a recording (see supabase/functions/process-session)
 * -- bullets may contain `**bold**` spans. Each section carries its own topic
 * filing, independently of the others -- a single recording can cover more
 * than one topic (see app/summary.tsx), so there is no longer a single
 * whole-session topic recommendation.
 */
export type SessionOutlineSection = {
  heading: string;
  bullets: string[];
  topic_id?: string | null;
  topic_suggestion?: string | null;
};
export type MessageRole = 'user' | 'assistant' | 'system';
export type TaskStatus = 'open' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high';
export type AttachmentType = 'audio' | 'image' | 'document';
/** The OpenAI TTS voices the app offers a preview for -- see preview-voice/converse Edge Functions. */
export type AiVoice = 'alloy' | 'echo' | 'onyx' | 'nova' | 'shimmer' | 'marin';
/** Repeating tasks (see supabase/migrations/20260929000001_reminders.sql). */
export type TaskRecurFreq = 'day' | 'week' | 'month';
export type ReminderKind = 'due' | 'daily' | 'once' | 'context';
export type ReminderPurpose = 'remind' | 'waiting';
export type ReminderOrigin = 'default' | 'user';
export type ReminderStatus = 'active' | 'stopped' | 'done';
export type ReminderTargetType = 'task' | 'session' | 'memory';
export type ReminderBucket = 'now' | 'later' | 'context';
export type ReminderReason =
  | 'overdue'
  | 'due_today'
  | 'daily'
  | 'scheduled_today'
  | 'pending'
  | 'snoozed'
  | 'not_today'
  | 'upcoming'
  | 'context';
export type ReminderAction = 'snooze' | 'not_today' | 'stop' | 'acknowledge' | 'resume';
export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined';

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
          /** How long a pause (ms) before Conversation mode treats the user's turn as over -- see useConversationSession.ts. */
          silence_gap_ms: number;
          /** Default local time ('HH:MM:SS') for automatic and every-day reminders. */
          reminder_time: string;
          remind_day_before: boolean;
          remind_day_of: boolean;
          /** Quiet hours ('HH:MM:SS'); both null = no quiet hours. */
          quiet_start: string | null;
          quiet_end: string | null;
          /** false: lock-screen pushes hide the title. */
          reminder_preview: boolean;
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
          silence_gap_ms?: number;
          reminder_time?: string;
          remind_day_before?: boolean;
          remind_day_of?: boolean;
          quiet_start?: string | null;
          quiet_end?: string | null;
          reminder_preview?: boolean;
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
          /** Standout, verbatim lines worth pulling out on their own -- empty (not null) when nothing qualified. */
          notable_quotes: string[];
          starred: boolean;
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
          notable_quotes?: string[];
          starred?: boolean;
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
          /** The client's turnId for a Conversation-mode turn (see converse) -- lets a retried turn replay instead of re-running. */
          client_turn_id: string | null;
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
          client_turn_id?: string | null;
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
          starred: boolean;
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
          starred?: boolean;
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
          /** In-app grouping (e.g. "Shopping", "Work") -- independent of Google Tasks, whose sync still uses one default list (see profiles-adjacent google_tasks_connections). */
          list_id: string | null;
          list_suggestion: string | null;
          starred: boolean;
          /** Repeating task: completing it moves due_date to the next occurrence (the row stays open). */
          recur_freq: TaskRecurFreq | null;
          recur_interval: number | null;
          recur_anchor: string | null;
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
          list_id?: string | null;
          list_suggestion?: string | null;
          starred?: boolean;
          recur_freq?: TaskRecurFreq | null;
          recur_interval?: number | null;
          recur_anchor?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['tasks']['Insert']>;
        Relationships: [];
      };
      task_lists: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          /** The Google Tasks list chosen for this list; null = automatic (the Google list with the same name). */
          google_task_list_id: string | null;
          google_task_list_title: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          google_task_list_id?: string | null;
          google_task_list_title?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['task_lists']['Insert']>;
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
          starred: boolean;
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
          starred?: boolean;
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
      google_tasks_sends: {
        Row: {
          id: string;
          user_id: string;
          task_id: string | null;
          memory_id: string | null;
          google_task_list_id: string;
          google_task_list_title: string | null;
          google_task_id: string;
          sent_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          task_id?: string | null;
          memory_id?: string | null;
          google_task_list_id: string;
          google_task_list_title?: string | null;
          google_task_id: string;
          sent_at?: string;
        };
        Update: Partial<Database['public']['Tables']['google_tasks_sends']['Insert']>;
        Relationships: [];
      };
      reminders: {
        Row: {
          id: string;
          user_id: string;
          task_id: string | null;
          session_id: string | null;
          memory_id: string | null;
          kind: ReminderKind;
          purpose: ReminderPurpose;
          origin: ReminderOrigin;
          title: string;
          note: string | null;
          source_session_id: string | null;
          source_quote: string | null;
          timezone: string;
          /** 'HH:MM:SS'; null = the profile's reminder_time. */
          local_time: string | null;
          /** Days relative to the due date (-1 = day before); null = the profile's day-before/day-of settings. */
          day_offsets: number[] | null;
          fire_at: string | null;
          start_date: string | null;
          ends_on: string | null;
          context_tag: string | null;
          status: ReminderStatus;
          status_reason: string | null;
          snoozed_until: string | null;
          suppressed_until: string | null;
          last_fired_at: string | null;
          /** Kept by a DB trigger -- never written by the app. */
          next_fire_at: string | null;
          lease_until: string | null;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          task_id?: string | null;
          session_id?: string | null;
          memory_id?: string | null;
          kind: ReminderKind;
          purpose?: ReminderPurpose;
          origin?: ReminderOrigin;
          title: string;
          note?: string | null;
          source_session_id?: string | null;
          source_quote?: string | null;
          timezone?: string;
          local_time?: string | null;
          day_offsets?: number[] | null;
          fire_at?: string | null;
          start_date?: string | null;
          ends_on?: string | null;
          context_tag?: string | null;
          status?: ReminderStatus;
          status_reason?: string | null;
          snoozed_until?: string | null;
          suppressed_until?: string | null;
        };
        Update: Partial<Database['public']['Tables']['reminders']['Insert']>;
        Relationships: [];
      };
      push_installations: {
        Row: {
          id: string;
          installation_id: string;
          user_id: string;
          expo_push_token: string | null;
          platform: 'ios' | 'android' | null;
          permission: PushPermissionStatus;
          enabled: boolean;
          last_error: string | null;
          last_seen_at: string;
          created_at: string;
          updated_at: string;
        };
        // Written only through register/unregister_push_installation (no insert/update policy).
        Insert: Partial<Database['public']['Tables']['push_installations']['Row']>;
        Update: Partial<Database['public']['Tables']['push_installations']['Row']>;
        Relationships: [];
      };
      task_completions: {
        Row: {
          id: string;
          user_id: string;
          task_id: string;
          occurrence_date: string | null;
          completed_at: string;
        };
        // Written only by the repeating-task trigger (no insert/update policy).
        Insert: Partial<Database['public']['Tables']['task_completions']['Row']>;
        Update: Partial<Database['public']['Tables']['task_completions']['Row']>;
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
      reminder_agenda: {
        Args: { p_user: string; p_now?: string | null };
        Returns: {
          target_type: ReminderTargetType;
          target_id: string;
          title: string;
          note: string | null;
          due_date: string | null;
          bucket: ReminderBucket;
          reason: ReminderReason;
          next_fire_at: string | null;
          snoozed_until: string | null;
          suppressed_until: string | null;
          context_tag: string | null;
          purpose: ReminderPurpose;
          source_session_id: string | null;
          is_recurring: boolean;
          reminder_ids: string[];
        }[];
      };
      reminder_act: {
        Args: {
          p_user: string;
          p_target_type: ReminderTargetType;
          p_target_id: string;
          p_action: ReminderAction;
          p_until?: string | null;
        };
        Returns: { next_fire_at: string | null; effective_until: string | null; affected: number }[];
      };
      register_push_installation: {
        Args: {
          p_installation_id: string;
          p_token: string | null;
          p_platform: 'ios' | 'android';
          p_permission: PushPermissionStatus;
        };
        Returns: void;
      };
      unregister_push_installation: {
        Args: { p_installation_id: string };
        Returns: void;
      };
    };
  };
};
