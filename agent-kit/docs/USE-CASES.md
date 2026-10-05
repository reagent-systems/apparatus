# Use cases

Each case has the same shape.
**Say** is what the user says or does. **Work** is what the agent does. **Hear** is what comes back, by voice and on the screen.

## Ask and hear

**Say.** "What time is it in Tokyo?"
**Work.** The voice model answers from what it knows. No job starts. No VM wakes.
**Hear.** One sentence, at once. The orb shows listening, then speaking.
Where speech does not fit, the user types the same question in the composer; the same voice model answers.

## Get a file made

**Say.** "Make me a CSV of the planets with their distance from the sun, and summarize it."
**Work.** The voice model says "I will do that" and calls start_job. The server runs the smart model, which writes the CSV in the task folder on the VM with the python tool and reads it back. The user keeps talking meanwhile.
**Hear.** "The CSV has 8 rows; Neptune is the farthest at 4.5 billion kilometers." The pane shows the table and the path.

## Collect data from a site with no API

**Say.** "Get this week's prices from the farm market page."
**Work.** The smart model reads the page as text first. Only when text fails does it take a screenshot and use the computer tool. The desktop lock keeps a second job from touching the mouse.
**Hear.** Two sentences with the headline numbers. The pane shows the full list.

## Log in once

**Say.** "Check my order status on the shop."
**Work.** The page asks for a login. The agent calls handoff. The feed shows the request; the phone gets a push; the voice says one sentence. The user opens the live view, logs in, and taps Done. The browser profile on the VM keeps the session, so the next job needs no login. During the handoff the agent takes no screenshot.
**Hear.** "Your order ships on Thursday."

## Watch and take the screen

**Say.** "Show me what you are doing." The user picks Screen in the pane, or taps the handoff card on the phone.
**Work.** The widget opens a stream; the VM sends its video over WebRTC through the TURN relay. The job keeps running. The user taps Control: the server tells the VM, and the agent's computer tool refuses until Release. Pointer and key events reach the desktop only while the user holds control or a handoff is active. Every take and release lands in the audit log.
**Hear.** Nothing changes in the voice. The pane shows the desktop live; the orb shows working. On a watch, nothing: the watch has no screen stream.

## Approve a send

**Say.** "Reply to Dana that Thursday works."
**Work.** The task code calls agentlib.request_approval("send", ...). The job pauses. The feed shows Approve and Deny; the voice says one sentence. Nothing is sent until the user approves. The audit log records the request and the answer.
**Hear.** "Sent." Or, after a deny: "I did not send it."
The Jobs desk lists every blocked job first with its Approve and Deny buttons, so the user answers without finding the card.

## Repeat a task cheaply

**Say.** "Same report as last week."
**Work.** Last week the agent saved `weekly_report.py` under /home/agent/tools/ and a line in its index. This week it imports the script. Few model steps run.
**Hear.** The same two sentences, sooner, for fewer credits.

## Pick up on another device

**Say.** The user started on the desktop and walks away with the phone. On the phone, they tap the orb.
**Work.** The phone claims the voice session; the desktop keeps the feed and the pane. The rolling summary loads into the new Live session, so the agent knows the thread.
**Hear.** The conversation continues on the phone. The desktop shows the same feed.

## Watch only

**Say.** The user presses and holds Talk on the watch: "Did the CSV job finish?"
**Work.** The watch streams audio while the button is held and ends the turn on release. The voice model calls check_job.
**Hear.** "Yes, it finished two minutes ago." A handoff on a watch arrives as a notification that says to continue on another device.

## Run while away

**Say.** "Collect the prices every morning and tell me." (A scheduled job, queued for a later item.)
**Work.** The VM wakes for the job and goes idle after it. No client has a session, so the server sends a push when the job ends. An idle VM costs only its disk.
**Hear.** A notification with the say line. The next voice session starts with the result in its summary.

## Pay with credits

**Say.** Nothing. The user subscribed on the web.
**Work.** Each paid cycle adds credits to the ledger. Every voice minute and every model step turns into credits as it happens. A job reserves a hold and returns the unused part. At 20% left the voice says so once. At zero, running jobs save their state and pause; nothing is deleted.
**Hear.** "You have about 20 percent of your credits left." The balance and the top-up button live on the settings screen only.
