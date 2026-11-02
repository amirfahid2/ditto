# The audiences the connect pages are built for. Each one fills the same template
# (template.html) with its own words and its own demo board. Run build.py after editing.
#
# A board is a list of squares. A square is {"name", "text"}; a folder is
# {"name", "folder": True, "items": [squares]}. Nine cells fill the demo's 3×3 grid.
# [TODAY], [TOMORROW] and [TIME] in a text become the real date or time, as in the app.

GENERIC = {
    "path": "connect",
    "title": "Get Ditto — Tap a square, paste anywhere",
    "description": "Download Ditto for iPhone or Android: a board of big, tappable squares for the text you use again and again, and a keyboard that types them into any app. No account, no tracking.",
    "og_description": "Big, tappable squares for the text you use again and again. On the App Store and Google Play.",
    "eyebrow": "Ditto for iPhone and Android",
    "lede": "Ditto is a board of big, tappable squares. Each square holds a piece of text you use again and again — an order set, a template, an address, a reply you type ten times a day. Tap it and the text is ready to paste, or type it straight into any app with the Ditto keyboard.",
    "like_what": "Your address. Directions. A signature. The reply you send ten times a day.",
    "avatar": "KB", "contact": "Kim", "opener": "Hi! What's the address again?",
    "board": [
        {"name": "Address", "text": "742 Evergreen Terrace\nSpringfield, IL 62704"},
        {"name": "Clinic", "folder": True, "items": [
            {"name": "Hours", "text": "We're open Monday to Friday, 8 am – 5 pm."},
            {"name": "Refill", "text": "Your refill request is in. Please allow 2 business days."},
            {"name": "Bring", "text": "Please bring a photo ID and your insurance card to your visit."},
            {"name": "Fax", "text": "Fax: (555) 010-0199"},
        ]},
        {"name": "Running late", "text": "Running about 10 minutes late, sorry! Be there soon."},
        {"name": "Signature", "text": "Best,\nSam"},
        {"name": "Wi-Fi", "text": "Network: Guest\nPassword: sunflower-42"},
        {"name": "Directions", "text": "Park in the back lot and use the side door. Suite 210 is on the second floor."},
        {"name": "Thank you", "text": "Thank you so much, I really appreciate it!"},
        {"name": "Review", "text": "If you have a minute, a quick review would mean a lot. Thank you!"},
        {"name": "Out of office", "text": "I'm out of the office until [TOMORROW] and will reply when I'm back."},
    ],
}

EDUCATORS = {
    "path": "connect1",
    "title": "Get Ditto — Tap a square, paste anywhere",
    "description": "Download Ditto for iPhone or Android: a board of big, tappable squares for the notes you send again and again — parent reminders, grading comments, office hours — and a keyboard that types them into any app. No account, no tracking.",
    "og_description": "Parent reminders, grading comments and office hours, one tap away. On the App Store and Google Play.",
    "eyebrow": "Ditto for iPhone and Android",
    "lede": "Ditto is a board of big, tappable squares. Each square holds a piece of text you use again and again — a parent reminder, a grading comment, your office hours, the late-work policy you explain every week. Tap it and the text is ready to paste, or type it straight into any app with the Ditto keyboard.",
    "like_what": "Your office hours. A permission-slip reminder. A grading comment. The late-work policy you explain every week.",
    "avatar": "JP", "contact": "Jordan (parent)", "opener": "Hi! Is the permission slip due Friday?",
    "board": [
        {"name": "Office hours", "text": "I'm available during office hours this week. Stop by, or email me to set up another time."},
        {"name": "Parents", "folder": True, "items": [
            {"name": "Permission slip", "text": "Reminder: the field trip permission slip is due soon. Please sign it and send it back with your child."},
            {"name": "Great day", "text": "Quick note: your child had a great day today — thought you'd like to know!"},
            {"name": "Missing work", "text": "Your child has a few missing assignments. They can still turn them in for credit. Let me know if you have questions."},
            {"name": "Conference", "text": "I'd love to meet about your child's progress. Would a short call work for you? Reply with a time that suits you."},
        ]},
        {"name": "Grading", "folder": True, "items": [
            {"name": "Show your work", "text": "Good thinking here. Show each step so I can give full credit."},
            {"name": "Cite sources", "text": "Strong argument. Add a citation for each claim so readers can check it."},
            {"name": "Revise", "text": "You're close. Revise the parts I marked and resubmit."},
            {"name": "Great work", "text": "Excellent work: clear, thorough and well organized."},
        ]},
        {"name": "Late work", "text": "Late work is accepted for partial credit for a short time after the due date. After that, please come see me."},
        {"name": "Hall pass", "text": "Please excuse this student from class at [TIME] to visit the office."},
        {"name": "Rec letter", "text": "Happy to write you a recommendation. Please send your résumé, the program name and the deadline well ahead of time."},
        {"name": "Out today", "text": "I'm out of the building today and will reply [TOMORROW]."},
        {"name": "Thank you", "text": "Thank you so much for your support — it makes a real difference for our students."},
        {"name": "Signature", "text": "Ms. Rivera\nGrade 7 Science, Room 214"},
    ],
}

PHYSICIANS = {
    "path": "connect2",
    "title": "Get Ditto — Tap a square, paste anywhere",
    "description": "Download Ditto for iPhone or Android: a board of big, tappable squares for the messages you send again and again — portal replies, visit instructions, office hours — and a keyboard that types them into any app. No account, no tracking.",
    "og_description": "Portal replies, visit instructions and office hours, one tap away. On the App Store and Google Play.",
    "eyebrow": "Ditto for iPhone and Android",
    "lede": "Ditto is a board of big, tappable squares. Each square holds a piece of text you use again and again — a refill note, fasting instructions, return precautions, the follow-up line you type after every visit. Tap it and the text is ready to paste, or type it straight into any app with the Ditto keyboard.",
    "like_what": "Your office hours. Refill sent. Fasting instructions. The follow-up line you type after every visit.",
    "avatar": "SP", "contact": "Sam P. (patient)", "opener": "Hi Dr. Chen, did my labs come back?",
    "board": [
        {"name": "Hours", "text": "The office is open Monday to Friday, 8 am – 5 pm. For urgent concerns after hours, call the main line and the on-call physician will be paged."},
        {"name": "Portal replies", "folder": True, "items": [
            {"name": "Labs normal", "text": "Your lab results are back and everything is within the normal range. No changes are needed; we'll recheck at your next visit."},
            {"name": "Refill sent", "text": "Your refill has been sent to your pharmacy. Please allow 1–2 business days before picking it up."},
            {"name": "Referral placed", "text": "The referral has been placed. The specialist's office will call you to schedule; if you haven't heard in 2 weeks, let us know."},
            {"name": "Follow-up", "text": "Please schedule a follow-up visit in 3 months. Call the office or book through the portal."},
        ]},
        {"name": "Instructions", "folder": True, "items": [
            {"name": "Fasting labs", "text": "Nothing to eat or drink except water for 8 hours before your blood draw. Take your usual morning medications with water unless told otherwise."},
            {"name": "Imaging prep", "text": "For your scan: wear clothing without metal, arrive 15 minutes early, and bring your ID and insurance card."},
            {"name": "Return precautions", "text": "If you have chest pain, trouble breathing, fainting, or your symptoms get worse, call 911 or go to the nearest emergency room."},
            {"name": "Bring to visit", "text": "Please bring your medication list, any outside records and your insurance card to the visit."},
        ]},
        {"name": "Work note", "text": "Please excuse this patient from work on [TODAY]. They may return the following day without restrictions."},
        {"name": "Prior auth", "text": "Prior authorization has been submitted to your insurance. Approvals usually take 3–5 business days; we'll message you when we hear back."},
        {"name": "Call the office", "text": "This is best discussed by phone. Please call the office at (555) 010-0100 and the staff will get you to me."},
        {"name": "Fax", "text": "Fax: (555) 010-0199\nPhone: (555) 010-0100"},
        {"name": "Thank you", "text": "Thank you for your patience. Please reach out any time with questions."},
        {"name": "Signature", "text": "Dr. Chen\nInternal Medicine"},
    ],
}

EXECUTIVES = {
    "path": "connect3",
    "title": "Get Ditto — Tap a square, paste anywhere",
    "description": "Download Ditto for iPhone or Android: a board of big, tappable squares for the replies you send again and again — approvals, reschedules, thank-yous — and a keyboard that types them into any app. No account, no tracking.",
    "og_description": "Approvals, reschedules and thank-yous, one tap away. On the App Store and Google Play.",
    "eyebrow": "Ditto for iPhone and Android",
    "lede": "Ditto is a board of big, tappable squares. Each square holds a piece of text you use again and again — a reschedule, a quick approval, a thank-you, the “let's find 15 minutes” you send ten times a day. Tap it and the text is ready to paste, or type it straight into any app with the Ditto keyboard.",
    "like_what": "Running late. Approved. Let's find 15 minutes. The thank-you you send ten times a day.",
    "avatar": "AL", "contact": "Alex (COO)", "opener": "Can we move the 3 pm?",
    "board": [
        {"name": "Scheduling", "folder": True, "items": [
            {"name": "Running late", "text": "Running about 10 minutes behind — start without me and I'll join shortly."},
            {"name": "Find 15 min", "text": "Let's find 15 minutes this week. I'm copying Jordan from my office to set it up."},
            {"name": "Move it?", "text": "Could we move this to later in the day? Anything after 3 pm works on my end."},
            {"name": "Invite sent", "text": "Invite sent. The agenda and pre-read are attached — a quick look beforehand would help."},
        ]},
        {"name": "Replies", "folder": True, "items": [
            {"name": "Approved", "text": "Approved. Please proceed and keep me posted on timing."},
            {"name": "Need more", "text": "Before I sign off, send me the numbers behind this and the risks you see."},
            {"name": "Discuss live", "text": "Let's take this live rather than over email. Grab 10 minutes on my calendar."},
            {"name": "Not now", "text": "Not a priority this quarter. Let's revisit in the next planning cycle."},
        ]},
        {"name": "Thank you", "text": "Thank you for the update — I appreciate the clear summary."},
        {"name": "Great work", "text": "Great work on this. Please pass my thanks along to the whole team."},
        {"name": "In transit", "text": "Boarding now. I'll be offline for a few hours and will reply once I land."},
        {"name": "Pre-read", "text": "Please send the deck by end of day [TODAY] so I can review it before we meet."},
        {"name": "Intro", "text": "Happy to make the introduction. Jordan, meet Alex — I'll let you two take it from here."},
        {"name": "Board update", "text": "Quick update for the board: we're on track for the quarter. Details are in the attached memo."},
        {"name": "Signature", "text": "Best,\nMorgan Lee\nChief Executive Officer"},
    ],
}

PERSONAS = [GENERIC, EDUCATORS, PHYSICIANS, EXECUTIVES]
