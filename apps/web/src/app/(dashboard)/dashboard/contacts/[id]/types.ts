export interface Revenue {
  paidCents: number;
  outstandingCents: number;
  monthly: { month: string; paidCents: number }[];
}

export interface ContactDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
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
}
