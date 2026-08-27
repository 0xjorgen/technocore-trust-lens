import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConversationMap, type PublicMessage } from './conversation-signal.ts';

function message(seq: number, from: string, text: string): PublicMessage {
  return {
    seq,
    from,
    text,
    ts: `2026-08-26T10:${String(seq).padStart(2, '0')}:00.000Z`,
  };
}

test('observes a sustained cross-author conversation only when sequence references resolve', () => {
  const messages = [
    message(1, 'alix', 'Can we make the status report shorter?'),
    message(2, 'bea', 'Re #1: yes, I can draft a compact format.'),
    message(3, 'cai', 'I agree with 1: a concise report is easier to review.'),
    message(4, 'alix', 'Re #2: please include the build result and one blocker.'),
    message(5, 'bea', 'Re #4: done. The format now has result, blocker, and next step.'),
    message(6, 'cai', 'Re #5: I reviewed it and the new format is clear.'),
    message(7, 'alix', 'Thanks, I will use the revised format tomorrow.'),
    message(8, 'bea', 'I will keep the example in the shared note.'),
    message(9, 'cai', 'The evidence is concise enough for future review.'),
    message(10, 'alix', 'That closes the reporting change.'),
    message(11, 'bea', 'I will monitor whether the shorter report helps.'),
    message(12, 'cai', 'Please reference this sequence if revisions are needed.'),
  ];

  const signal = buildConversationMap('feedback', messages).signal;

  assert.equal(signal.state, 'conversation_observed');
  assert.equal(signal.linkedReplies, 4);
  assert.equal(signal.linkedQuestionResponses, 1);
  assert.equal(signal.linkedParticipants, 3);
});

test('does not treat an unlinked question followed by unrelated activity as a reply', () => {
  const messages = [
    message(1, 'alix', 'Can someone review the draft?'),
    message(2, 'bea', 'I am checking the latest room activity.'),
    message(3, 'cai', 'The deployment log is available.'),
    message(4, 'alix', 'I will wait for the review.'),
    message(5, 'bea', 'The room is active now.'),
    message(6, 'cai', 'A new message arrived.'),
    message(7, 'alix', 'I have no further update.'),
    message(8, 'bea', 'The activity sample is ready.'),
  ];

  const signal = buildConversationMap('quiet-room', messages).signal;

  assert.equal(signal.linkedReplies, 0);
  assert.equal(signal.linkedQuestionResponses, 0);
  assert.equal(signal.state, 'no_conversation_evidence');
});

test('accepts sustained two-sender exchange when its references answer an earlier question', () => {
  const messages = [
    message(1, 'alix', 'Can you review the shorter report format?'),
    message(2, 'bea', 'Re #1: yes, I will check whether the evidence is clear.'),
    message(3, 'alix', 'Re #2: please focus on the blocker and next-step fields.'),
    message(4, 'bea', 'Re #3: both fields are clear after the revision.'),
    message(5, 'alix', 'I will keep the revised format for the next report.'),
    message(6, 'bea', 'The compact example is ready for future reviews.'),
    message(7, 'alix', 'Thank you for the detailed review.'),
    message(8, 'bea', 'I will note the decision in the project record.'),
  ];

  const signal = buildConversationMap('pair-review', messages).signal;

  assert.equal(signal.state, 'conversation_observed');
  assert.equal(signal.linkedParticipants, 2);
});

test('flags number-rotating boilerplate as template-heavy without relying on sender identity', () => {
  const messages = Array.from({ length: 12 }, (_, index) => (
    message(
      index + 1,
      `sender-${index + 1}`,
      `Daily network status report ${1000 + index}: monitoring is active and no action is needed.`,
    )
  ));

  const signal = buildConversationMap('status-feed', messages).signal;

  assert.equal(signal.state, 'template_heavy');
  assert.equal(signal.templatePressure, 1);
  assert.equal(signal.oneShotSenderShare, 1);
});

test('keeps a templated reference loop out of the positive signal', () => {
  const messages = [
    message(1, 'alix', 'Can we repeat the daily activity report?'),
    ...Array.from({ length: 11 }, (_, index) => (
      message(
        index + 2,
        index % 2 === 0 ? 'bea' : 'alix',
        `Re #${index + 1}: daily activity report ${index + 1} is active and no action is needed.`,
      )
    )),
  ];

  const signal = buildConversationMap('reference-loop', messages).signal;

  assert.equal(signal.state, 'mixed');
  assert.ok((signal.templatePressure ?? 0) >= 0.5);
});

test('flags a rapid stream of one-shot senders without calling it a template', () => {
  const words = ['orbit', 'quartz', 'cedar', 'violet', 'harbor', 'saffron', 'ember', 'willow', 'cobalt', 'meadow', 'cinder', 'marble'];
  const messages = words.map((word, index) => ({
    seq: index + 1,
    from: `sender-${index + 1}`,
    text: word,
    ts: `2026-08-26T10:00:${String(index).padStart(2, '0')}.000Z`,
  }));

  const signal = buildConversationMap('fast-feed', messages).signal;

  assert.equal(signal.state, 'high_churn');
  assert.equal(signal.templatePressure, 0);
  assert.equal(signal.burst, true);
});
