import React from 'react';

import { LegalDocScreen } from '@/components/LegalDocScreen';
import { TERMS_OF_SERVICE } from '@/content/legal';

export default function TermsOfServiceScreen() {
  return <LegalDocScreen doc={TERMS_OF_SERVICE} />;
}
