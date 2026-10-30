/** Confirm-dialog text for a client invite: the link signs them straight in, so a typo would let a stranger in. */
export function confirmInviteOptions(email: string): { title: string; message: string; confirmLabel: string } {
  return {
    title: "Send portal invite?",
    message: `${email} will be able to open your client portal with one click, no password. Check the address is right.`,
    confirmLabel: "Send invite",
  };
}
