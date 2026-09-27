# Dashboard UX

Why the dashboard changed in September 2026, and the rules to keep.

## The problem

Six fields asked people to type lists into a textarea, one per line, and then
explained the format in a paragraph underneath: include terms, exclude terms,
subreddits, feed URLs, competitors, disqualifiers. That is a config-file format
wearing a form's clothes.

1. You cannot see what is saved. Ten lines look like a paragraph, not ten
   separate things, and removing the sixth means editing text by hand.
2. The format is invisible until you break it — quoting a phrase, `r/` or not,
   one per line or commas.
3. The hint did the work the control should. The include-terms hint ran to
   sixty words because the input could not show what quoting meant.

The copy had one voice throughout: complete, correct, and about the system.
"A post must match at least one of these before the classifier reads it, so
these are a net rather than a judgement" describes our architecture, not the
reader's job.

## The rules now

**Lists are chips, never lines of text.** `TagInput` is the one control for
every list. Type and press Enter, comma or Tab; paste a list and it splits,
trims and de-duplicates; each chip removes itself with a click; the count sits
in the label because limits are real (ten search terms per poll).

**A control explains itself; a hint does not explain a format.** Quoting a
phrase became a per-chip "exact phrase" toggle, so nobody reads about quotes.
A bad feed URL is marked on the chip when it is added, not on save.

**Labels are the question you would ask out loud.** "Who buys it?" rather than
"Who it is for". Hints are one line and say what the person gets — "Takes
effect within the hour" rather than "Applies from the next classification run".

**Show the consequence, not the mechanism.** Under the terms field, a real
count of how many of the last 500 posts those words catch, with examples. It
costs nothing — the filter is a pure function over posts already stored — and
it is the difference between guessing at terms and tuning them. It would have
shown at a glance that `go to market` matched 193 posts and produced no leads.

**Progressive enhancement.** Every chip input renders as a plain textarea on
the server and submits the same newline-joined value, so the server actions did
not change and the forms still work before hydration.

## Deliberately unchanged

The Leads page structure — score, why it matters, reply angle — works. Settings
works. "What you sell" keeps one save per card, because those are four separate
judgements, not one form; it only gained a line saying how many are filled in.
