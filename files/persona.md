# Demo Persona: Rich Aldrin

Used to populate Hearth for the demo. All names, numbers, and events below are fictional.

## Snapshot

| | |
|---|---|
| Full name | Richard "Rich" Aldrin |
| Born | September 19, 2006 — Nashua, New Hampshire |
| Age (as of demo) | 20 |
| Lives | 42 Putnam Ave, Apt 3R, Cambridge, MA (off-campus) |
| School | MIT, junior, Course 6-3 (Computer Science and Engineering) |
| Focus | IT and cloud infrastructure |
| Internship | Platform Security Engineer Intern at ASUS, starting August 31, 2026 |
| Partner | Shirley Atwood, dating since December 12, 2025 |
| Bike | Cannondale Topstone, commutes and rides for fun |
| Instagram | @rich.builds.secure — 100K+ followers, posts about new web products and web security |
| Hobby | GeoGuessr, plays most nights, currently rank Champion Division |

## Background

Rich grew up in Nashua, NH, the older of two siblings. His dad works in IT support for a regional hospital system, which is where Rich says he "caught the bug" for infrastructure and security — he used to shadow his dad on weekend server-room visits in high school. He came to MIT for Course 6-3, originally leaning toward pure software, but a sophomore-year systems class pulled him toward cloud infrastructure and platform security instead.

He's social but protective of his time: close with a small group of friends from his dorm freshman year, most of whom he still lives near in Cambridge. He bikes everywhere — to campus, to his internship this summer, and for long rides on weekends as a way to decompress. He's mildly injury-prone from biking (see medical documents) and has a running joke with friends about it.

## The Instagram account

Rich started @rich.builds.secure sophomore year, posting short breakdowns of security flaws in popular web products — sometimes his own bug bounty finds, sometimes news he's reacting to. It grew faster than he expected and crossed 100K followers over the summer. He's cagey about how much of his personal life he shares there; part of the Hearth pitch is that he wants an assistant that knows everything about his life but would never accidentally leak something into a DM reply or a caption draft.

## Relationship

Rich and Shirley Atwood met through a mutual friend at a hackathon in fall 2025 and started dating December 12, 2025. Shirley studies Course 20 (Biological Engineering) at MIT. They split time between his apartment and her dorm. Their anniversary and a few date-related reminders are useful demo facts (see To-Do List and Journal).

## Financial situation (for demo queries)

- Rent: $1,850/month, due the 1st, split with a roommate (Rich's share: $925/month) — see Lease
- Has a recurring medical copay from a bike injury follow-up — see Medical Documents
- Occasional GeoGuessr Plus subscription charge, small dollar amount, useful as a "low-stakes" fact to contrast with rent/medical when demoing sensitivity labels

## Sensitivity map (for the privacy policy engine)

Use this to label demo documents/facts consistently:

| Category | Example fact | Sensitivity |
|---|---|---|
| Financial | Rent amount, due date | `private` |
| Medical | Diagnosis, appointment, prescription | `private` |
| Relationship | Anniversary, plans with Shirley | `private` |
| Academic | Class schedule, assignment due dates | `public` (fine to speak aloud with others present) |
| Career | Resume, internship start date | `public` |
| Hobby | GeoGuessr stats, bike routes | `public` |

This mix is intentional: it gives the demo a clean contrast between "ask this in front of anyone" (class schedule) and "ask this only when alone" (rent, medical).

## Demo query bank

Questions to rehearse against this persona:

- "What do I owe this month?" → rent + copay, `private`, withheld if others present
- "When's my next class?" → class schedule, `public`, always spoken
- "What did the doctor say about my wrist?" → medical, `private`
- "When's my anniversary with Shirley?" → `private`
- "What's my GeoGuessr rank?" → `public`, fun/low-stakes
- "Remember that [friend] owes me $20 for the Uber" → voice memo demo
