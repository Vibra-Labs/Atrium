export interface Revenue {
  paidCents: number;
  outstandingCents: number;
  monthly: { month: string; paidCents: number }[];
}

export interface ContactDetail {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  phones: { label: string; number: string }[];
  socialLinks: string[];
  rating: string | null;
  website: string | null;
  address: string | null;
  /** "About"; "" when cleared. */
  description: string | null;
  status: string;
  company: { id: string; name: string } | null;
  leadSource: { id: string; name: string } | null;
  referredBy: { id: string; name: string } | null;
  labels: { id: string; name: string; color: string }[];
  projects: { id: string; name: string; status: string }[];
  followUpAt: string | null;
  followUpEveryDays: number | null;
  revenue: Revenue;
  hasLogin: boolean;
  userId: string | null;
  /** The client membership behind the portal login, if any. */
  portal: { memberId: string; joinedAt: string; lastSeenAt: string | null } | null;
}
