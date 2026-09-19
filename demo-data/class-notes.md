# 6.5800 Computer Systems Security — Lecture Notes

### Lecture 6 — Sept 15, 2026: Authentication and Session Management

- Distinguishing authentication (who you are) from authorization (what you can do)
- Session tokens: should be random, high-entropy, tied to expiration + rotation
- Common flaw: predictable session IDs (sequential, timestamp-based)
- Discussed cookie flags: `HttpOnly`, `Secure`, `SameSite`
- Case study: session fixation attack — attacker sets victim's session ID before login

**PSet 2 hint:** question 3 wants us to identify the session fixation vector in the provided Flask app — check where `session_id` is assigned relative to the login handler.

---

### Lecture 7 — Sept 17, 2026: Privilege Separation

- Principle of least privilege — every component gets only the access it needs
- Sandboxing vs. containerization vs. full VM isolation, tradeoffs in overhead vs. isolation strength
- Real-world example: browser process-per-tab architecture
- Relevant to my ASUS internship — asked Dr. Kowalski a question after class about how this applies to firmware-level provisioning, she pointed me to a paper on TPM-backed attestation

**Follow-up reading:** "Trusted Platform Module: A Survey" — check MIT library access
