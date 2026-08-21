# vocabulary-practice

This is a vocabulary practice website that will help you learn many words.

JAI:
hi surya

SURYA:
hi jai

JAI:
what do you think we should do for the next steps of the plaN????

SURYA:
What plan? For the website? Also, this is a dumb way of communicating.
If it's for the website, maybe add another game. I was using it, and I added features that I really wanted, such as the batches.

JAI:
should i add an account based thingy???????? also this way of communicating is not DUMB :) also when is your ssat are you keeping up with your cards. btw i have to take the psat in the fall 

SURYA:
I'm taking two SSATs, one on Sept 5th and one later in October. The vocab cards are very helpful if that's what you meant. 
What's the PSAT for? I'm just curious.
Also, go ahead and add an account based thing.

I'm probably going to add achievements.

JAI:
OK, also the psat is literally the SAT but it doesn't go in the gradebook or anything. my school requires me to take it :(

Though, since this repo belongs to you, I think you may need to set up the database, but I can connect all the code and build the page itself. Go to Supabase.com and just ask AI what to do next. Tell me when you're done.

SURYA:
Okay. I'll set up the Supabase. I'll tell you when I'm done.

I think I'm done. I asked ChatGPT if it could add a file with the API key. It did, and it's called   window.VOCAB_SUPABASE.publishableKey

Tell me if it all works out.

JAI: 
Ok, I am going to create a sign in page as the first thing you see / sign up but check if you made profile tables
Also can you paste the project URL and anon key here from supabase so i can set everything up? Thanks

SURYA:
I invited you to the Supabase project. I have not yet set up the profile tables yet. I'll work on doing that. Here are the other things you asked for:

Project URL: https://tcbndrskdnnchtehxegu.supabase.co

Publishable Key: sb_publishable_IjUF0itUavwXBZCej9ZdHg_Ap6tyg1V

I just set up the profile tables. 

JAI:

How do I accept the request. - UPDATE: I just accepted it thank you!

Thank you for all the things I needed, I'll set up the profiles now.

SURYA: 
Great! Glad it all worked out.

JAI: I don't really know what other features could be there that are completely necessary to the app, so I'll do some UI / UX improvements.

## Supabase achievement setup

Achievements are saved per account in Supabase and cached locally so the site still works if the network is unavailable. Before cloud syncing will work, open the Supabase SQL Editor, paste the contents of `supabase-achievements.sql`, and run it once. The included Row Level Security policies only allow signed-in users to access their own achievement data.

## Supabase username setup

Unique usernames and the signed-in user search require one additional table. Open the Supabase SQL Editor, paste the contents of `supabase-public-profiles.sql`, and run it once. Usernames are unique regardless of capitalization. Signed-in users can search aggregate public learning stats, while only each profile owner can create or update their row.

## Supabase progress setup

JAI:
Following the same pattern as achievements, session stats (got it/almost/don't know counts), high scores (Bubble, Whack-a-Word, Wordbound), and daily streak now sync per account too, so progress carries over across devices. Same deal: run `supabase-progress.sql` once in the SQL Editor before it'll sync. If the table isn't there yet it just keeps saving locally, nothing breaks.

## Supabase online challenge setup

Online Memory Match, Paragraph Duel, Bubble Shot, Whack-a-Word, and Taboo challenges use a participant-only Supabase table with live updates. Open the Supabase SQL Editor, paste the contents of `supabase-online-challenges.sql`, and run it once. Re-run the same file after pulling an update that adds a new online game type. The included Row Level Security policies only let the challenger and opponent read or update their match, and the setup adds the table to Supabase Realtime so turns, live clues, and results appear on both devices.

SURYA: I'm disappointed in your username. Also, CleverYak970 is Nila.

SURYA: What do you think we should do next for the website?


JAI: 

#1 how do you know that suryaloves67 is from me??? It's clearly not
#2: I think we should shift into UI improvement because everything looks a little messy. Also are we publishing the app?
