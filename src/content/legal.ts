/**
 * Source of truth for the in-app Privacy Policy / Terms of Service screens
 * (app/legal/*.tsx) AND the standalone HTML pages published for app-store
 * listing URLs (docs/legal/*.html) -- keep both in sync with this file by
 * hand when editing, since the HTML pages can't import TS at build time.
 *
 * COMPANY_NAME/CONTACT_EMAIL/GOVERNING_LAW are drawn from what's already in
 * the app (bundle id com.liflux.mindrecord) or left as placeholders -- see
 * the deployment note where these are used for what still needs sign-off
 * before this goes in front of app reviewers.
 */
export const COMPANY_NAME = 'Liflux';
export const APP_NAME = 'Mind Record';
export const CONTACT_EMAIL = 'privacy@liflux.com';
export const GOVERNING_LAW = '[governing law / jurisdiction -- to be confirmed]';
export const EFFECTIVE_DATE = 'September 20, 2026';

export type LegalSection = { heading: string; paragraphs: string[] };
export type LegalDoc = { title: string; sections: LegalSection[] };

export const PRIVACY_POLICY: LegalDoc = {
  title: 'Privacy Policy',
  sections: [
    {
      heading: 'Overview',
      paragraphs: [
        `${APP_NAME} is a voice journaling app made by ${COMPANY_NAME}. You speak, and the app transcribes, summarizes, and organizes what you said into records, tasks, and ideas. This policy explains what we collect, why, and how you can control it.`,
      ],
    },
    {
      heading: 'Information We Collect',
      paragraphs: [
        'Account information: your email address, and your name if you sign in with Apple or Google and choose to share it.',
        'Voice recordings: audio you record in the app. Recordings are sent to our speech-to-text provider for transcription and are deleted from our storage immediately after processing -- we do not keep the audio itself.',
        'Content you create: transcripts, summaries, tasks, ideas, and topics derived from your recordings and conversations with the AI.',
        'Usage data: technical records of processing events (for example, how many seconds of audio or how many AI replies a session used), kept for cost and reliability measurement. This is not used for billing today.',
        'Google Tasks connection (optional): if you connect Google Tasks, we store an OAuth token on our server so the app can send tasks on your behalf. This token is never exposed to the app itself or any third party other than Google.',
        'Device security: if you turn on biometric lock (Face ID / fingerprint), that preference and the biometric check itself are handled entirely by your device’s operating system. We never receive your biometric data.',
      ],
    },
    {
      heading: 'How We Use Your Information',
      paragraphs: [
        'To provide the service: transcribing your speech, generating summaries and AI replies, organizing tasks/ideas/topics, and syncing your records across your signed-in devices.',
        'To operate and secure the service: authenticating you, preventing abuse, and diagnosing errors.',
        'To measure infrastructure cost and usage patterns, so we can keep the service reliable and, in the future, design fair pricing.',
        'We do not use your recordings or transcripts to train AI models, and we do not sell your personal information.',
      ],
    },
    {
      heading: 'Third-Party Service Providers',
      paragraphs: [
        `We rely on the following processors to run ${APP_NAME}. Each only receives what it needs to do its job:`,
        'OpenAI -- transcribes your audio (Whisper), analyzes and summarizes your transcripts and generates AI conversation replies (GPT-4o-mini), and generates the AI’s spoken voice (TTS). OpenAI processes this data under its own API data-use terms, which (at the time of writing) exclude API content from being used to train OpenAI’s models.',
        'Supabase -- hosts our database, file storage, authentication, and server-side functions.',
        'Google -- if you sign in with Google, or connect Google Tasks, Google processes the identity or task data involved in that action under Google’s own privacy policy.',
        'Apple -- if you sign in with Apple, Apple processes the identity data involved under Apple’s own privacy policy.',
      ],
    },
    {
      heading: 'Data Retention & Deletion',
      paragraphs: [
        'Audio recordings are deleted from our storage as soon as processing (transcription) finishes -- typically within moments of you finishing a recording.',
        'Text content (transcripts, summaries, tasks, ideas, topics) is kept until you delete it, or until you delete your account.',
        `You can delete individual records inside ${APP_NAME} at any time. You can also permanently delete your account from Account → Delete account, which erases your recordings, transcripts, tasks, ideas, topics, and account itself. This cannot be undone.`,
        'Disconnecting Google Tasks removes our stored access token immediately, but does not delete tasks you already sent to Google Tasks -- those live in your Google account and are governed by Google’s own retention.',
      ],
    },
    {
      heading: 'Data Security',
      paragraphs: [
        'Your data is encrypted in transit (HTTPS/TLS) and access to it is restricted by row-level security so that only your own signed-in account can read your records. No method of transmission or storage is 100% secure, but we work to protect your information using industry-standard practices.',
      ],
    },
    {
      heading: 'Your Choices & Rights',
      paragraphs: [
        'You can access, edit, or delete your recordings, transcripts, tasks, ideas, and topics at any time inside the app.',
        'You can disconnect Google Tasks at any time from Account → Google Tasks.',
        'You can turn biometric lock on or off at any time from Account → Privacy.',
        'You can delete your account and all associated data at any time from Account → Delete account.',
        `To request a copy of your data, or ask us anything about this policy, contact us at ${CONTACT_EMAIL}.`,
      ],
    },
    {
      heading: "Children's Privacy",
      paragraphs: [
        `${APP_NAME} is not directed at children and is not intended for use by anyone under 13 (or the minimum age required by your country’s law). We do not knowingly collect information from children.`,
      ],
    },
    {
      heading: 'International Data Transfers',
      paragraphs: [
        'Our service providers may process and store data in countries other than your own. By using the app, you understand that your information may be transferred to and processed in those countries.',
      ],
    },
    {
      heading: 'Changes to This Policy',
      paragraphs: [
        'We may update this policy from time to time. If we make material changes, we’ll let you know inside the app before they take effect.',
      ],
    },
    {
      heading: 'Contact Us',
      paragraphs: [`Questions about this policy? Email us at ${CONTACT_EMAIL}.`],
    },
  ],
};

export const TERMS_OF_SERVICE: LegalDoc = {
  title: 'Terms of Service',
  sections: [
    {
      heading: 'Agreement to Terms',
      paragraphs: [
        `These Terms of Service ("Terms") govern your use of ${APP_NAME}, provided by ${COMPANY_NAME}. By creating an account or using the app, you agree to these Terms. If you don’t agree, please don’t use the app.`,
      ],
    },
    {
      heading: 'Description of Service',
      paragraphs: [
        `${APP_NAME} lets you record your voice or have a spoken conversation with an AI, and turns that into transcripts, summaries, tasks, and ideas organized by topic. It optionally lets you send tasks to your Google Tasks account.`,
      ],
    },
    {
      heading: 'Eligibility & Account Registration',
      paragraphs: [
        'You must be able to form a binding contract to use this service, and must provide accurate information when creating your account (email, or via Apple/Google sign-in). You are responsible for keeping your account credentials secure.',
      ],
    },
    {
      heading: 'Your Content',
      paragraphs: [
        'You own what you record and create in the app. By using the service, you grant us a limited license to process your recordings and content solely to provide the service to you (transcription, analysis, AI replies, and organization) as described in our Privacy Policy.',
        'You’re responsible for the content you record. Don’t use the app to record or process content that is illegal, infringes someone else’s rights, or that you don’t have the right to share.',
      ],
    },
    {
      heading: 'Acceptable Use',
      paragraphs: [
        'Don’t attempt to disrupt the service, access other users’ data, reverse-engineer the app, or use it in a way that violates applicable law or these Terms.',
      ],
    },
    {
      heading: 'Subscriptions & Payments',
      paragraphs: [
        `${APP_NAME} is currently free to use. If we introduce paid plans in the future, we’ll clearly disclose the price, billing period, and cancellation method before you subscribe, and any purchases will be handled through the App Store or Google Play’s standard subscription terms.`,
      ],
    },
    {
      heading: 'Third-Party Services',
      paragraphs: [
        'The app relies on third-party services (including OpenAI for transcription/AI, and optionally Google Tasks) to function. Your use of those integrations is also subject to that provider’s own terms.',
      ],
    },
    {
      heading: 'Disclaimers',
      paragraphs: [
        `${APP_NAME} is provided "as is." AI-generated summaries, replies, and extracted tasks/ideas may be inaccurate or incomplete -- always use your own judgment before relying on them. ${APP_NAME} is not a medical, mental-health, legal, or professional service, and is not a substitute for professional advice or care.`,
      ],
    },
    {
      heading: 'Limitation of Liability',
      paragraphs: [
        `To the maximum extent permitted by law, ${COMPANY_NAME} is not liable for any indirect, incidental, or consequential damages arising from your use of the app, including loss of data. Nothing in these Terms limits liability that cannot be limited under applicable law.`,
      ],
    },
    {
      heading: 'Termination',
      paragraphs: [
        'You can stop using the app and delete your account at any time from Account → Delete account. We may suspend or terminate accounts that violate these Terms.',
      ],
    },
    {
      heading: 'Changes to These Terms',
      paragraphs: [
        'We may update these Terms from time to time. If we make material changes, we’ll let you know inside the app before they take effect.',
      ],
    },
    {
      heading: 'Governing Law',
      paragraphs: [`These Terms are governed by the laws of ${GOVERNING_LAW}.`],
    },
    {
      heading: 'Contact Us',
      paragraphs: [`Questions about these Terms? Email us at ${CONTACT_EMAIL}.`],
    },
  ],
};
