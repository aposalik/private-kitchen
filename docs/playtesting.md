# Phase 7 Playtest Protocol

## Status and evidence boundary

Automated implementation is complete; the human playtest gate is pending.
Automated checks can prove role permissions, recipe privacy, UI state, local
record validation, and export behavior. They cannot prove participation,
clarity, frustration, enjoyment, physical communication quality, or replay
intent. Do not populate human results from automated runs.

## Participants and equipment

- Use three friends on three isolated devices with separate headsets.
- Use the supported landscape layout and one isolated browser profile per
  person.
- Run several rounds and rotate roles so each person experiences Blind Cook,
  Recipe Keeper, and Deaf Kitchen Guide.
- Keep the existing voice policy unchanged. Do not add another voice path,
  unrestricted text, or coaching channel.

Before the first round, explain only the role title, the objective shown in the
briefing, the available controls, and how to submit/export structured feedback.
Do not reveal the private recipe to a non-Keeper.

## Facilitator script

1. Say: “Work only from the role briefing and controls on your own device.
   Complete the recipe before the timer expires.”
2. Say: “During the round I will observe but will not explain a signal, suggest
   an action, reveal recipe content, or coach the team.”
3. Start once all three participants confirm that they can see their assigned
   role.
4. During play, record only observable participation using the structured
   session template. Do not record names, quotes, room codes, account or session
   identifiers, IP addresses, audio, drawings, or free-form responses.
5. After the authoritative win/loss screen, ask each participant to complete
   the on-device structured debrief independently.
6. Collect the exported JSON, confirm collection, then have each participant
   use **Clear local records**.

If setup, safety, or equipment fails, stop the round. Otherwise, do not
intervene until the authoritative terminal result.

## Measures

Each on-device record contains only:

- role and authoritative `WON`/`LOST` outcome;
- completed and total authoritative steps;
- locally observed running duration in whole seconds;
- participation, communication clarity, and frustration ratings from 1–5;
- replay intent: `YES`, `MAYBE`, or `NO`;
- misunderstood signal categories: `POINT`, `GESTURE`, `EMOTE`,
  `RECIPE_CARD`, `DRAWING`, `VOICE`, or `NONE`;
- schema version and generated ordering timestamp.

The facilitator template records whether each role showed observable
participation, using structured choices only. Completion and duration come from
the export. Never infer a rating or replay intent from behavior.

## Export and deletion

The browser retains at most 30 valid records under
`cooperative-cooking:phase7:playtest-feedback`. The game makes no feedback
network request. At the end of a session:

1. Select **Export JSON** on each device.
2. Verify that the downloaded JSON opens and contains only the documented
   fields.
3. Transfer the files using the facilitator’s approved offline collection
   method.
4. Confirm receipt, then select **Clear local records** on each device.
5. Verify that export now returns an empty array.

Clearing targets only the Phase 7 feedback key. Do not attach names, account
data, room/session identifiers, IP addresses, notes, audio, or drawing payloads
to an export.

## Evaluation and balance decisions

Do not claim Phase 7 human acceptance until several three-person rounds are
complete with role rotation and the structured evidence covers participation,
misunderstood signals, completion, frustration, observed length, and replay
intent.

Keep product changes in a separate decision log:

| Hypothesis | Planned UI/balance change | Authority/privacy review | Retest evidence | Decision |
| --- | --- | --- | --- | --- |
| Pending human evidence | No change yet | Pending | Pending | Pending |

The log describes development hypotheses and changes, not participant quotes
or free-form feedback. Every accepted change requires another structured
playtest under the same protocol.
