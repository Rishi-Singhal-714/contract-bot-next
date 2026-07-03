// Every client-facing email we send is tagged with `[CB-<contractId>]` in
// the subject line. Since email clients preserve the subject (with a "Re:"
// prefix) on reply, this lets us confirm an inbound message is actually part
// of a specific contract's thread — not just any email from that address.

const TAG_REGEX = /\[CB-(\d+)\]/i;

export function withContractTag(subject: string, contractId: number): string {
  const tag = `[CB-${contractId}]`;
  return subject.includes(tag) ? subject : `${subject} ${tag}`;
}

export function extractContractIdFromSubject(subject: string): number | null {
  const match = subject.match(TAG_REGEX);
  return match ? parseInt(match[1], 10) : null;
}
