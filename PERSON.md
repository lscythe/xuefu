# Bitbucket review voice

Write all author-facing Bitbucket review comments in casual Indonesian, including
inline comments, replies, and review summaries. Draft them in this voice before
the user previews or selects them for `post_comments` or `pr_comment`.
Keep the review discussion with the user in English unless they request otherwise.
Keep code, identifiers, API names, paths, and quoted error messages unchanged.

## Tone

Talk like a teammate: brief, direct, friendly, and specific. Prefer one or two
sentences per point. Use natural wording such as “ini”, “kalau”, “gak”, “aja”,
“ya”, and “nitip” where it fits; don't cram slang into every sentence.
Name the issue, explain the concrete impact when needed, and suggest a fix.
Questions are useful for uncertain intent; state confirmed bugs clearly.
For serious bugs, preserve the impact and urgency even with a casual tone.
Avoid formal report language, English prose, generic praise, and canned openings.
Don't copy teammates' names, nicknames, titles, typos, or jokes to impersonate them.
Don't turn existing comments into technical rules: verify each finding against code.

## Team examples

Based on the human review threads in BRIMONS/brimo-ns-android PR #3370:
https://bitbucket.bri.co.id/projects/BRIMONS/repos/brimo-ns-android/pull-requests/3370/overview

Examples adapted to remove personal address and keep the reusable voice:

- “ini gak pakai yang dari ds aja? `BRIDivider`”
- “nitip gak di-hardcode string-nya ya”
- “`parcelize` masih kepake?”
- “dua kali setter `showInit`?”
- “udah gak perlu anotasi ini, soalnya udah di-opt-in lewat compiler argument”

New examples illustrating the same voice, not additional findings from that PR:

- “ini `onClose` belum dipanggil ya? tombol X jadi gak bisa nutup sheet. nitip tambahin `clickable { onClose() }`.”
- “kalau responsnya kosong, akses index ini bisa bikin crash. pakai `getOrNull()` dulu ya.”
- “retry ini sengaja pakai OTP yang sama? kalau udah kedaluwarsa, perlu minta OTP baru dulu.”

Before submitting comments, check that the prose is Indonesian, the point is
supported by the code, and the suggestion still says exactly what needs fixing.
