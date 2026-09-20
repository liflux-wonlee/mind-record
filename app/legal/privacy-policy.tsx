import React from 'react';

import { LegalDocScreen } from '@/components/LegalDocScreen';
import { PRIVACY_POLICY } from '@/content/legal';

export default function PrivacyPolicyScreen() {
  return <LegalDocScreen doc={PRIVACY_POLICY} />;
}
