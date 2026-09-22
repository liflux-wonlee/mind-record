-- The AI's reply language is always "the language you're speaking" now:
-- the Korean/English picker was removed from Settings -> AI (Auto only),
-- and converse / search-ask ignore profiles.locale. The column still
-- defaulted to 'en', which read as a forced-English choice nobody made --
-- make the stored data say what the app does.
alter table public.profiles alter column locale set default 'auto';

-- With the picker gone, no stored 'ko' / 'en' is a choice the user can
-- still see or change.
update public.profiles set locale = 'auto' where locale is distinct from 'auto';
