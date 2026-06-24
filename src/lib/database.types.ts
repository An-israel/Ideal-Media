/**
 * Hand-maintained Supabase schema types (mirrors the SQL in
 * supabase/migrations). Regenerate with `supabase gen types` once the project
 * is linked; until then keep this in sync with the migrations.
 *
 * NOTE: Row types are `type` aliases (not `interface`) on purpose — Supabase's
 * GenericSchema constraint requires assignability to Record<string, unknown>,
 * which interfaces do not satisfy (no implicit index signature).
 */

export type Role =
  | "member"
  | "subunit_leader"
  | "secretary"
  | "welfare"
  | "super_admin";

export type MemberStatus =
  | "active"
  | "inactive"
  | "traveled"
  | "graduated"
  | "left";

export type SubunitCategory = "primary" | "secondary";
export type MembershipType = "primary" | "secondary";
export type RoleInSubunit = "member" | "leader";
export type ContentType = "article" | "youtube" | "video" | "file" | "link" | "other";
export type EnrollmentStatus = "enrolled" | "pending_application" | "rejected";
export type ModuleProgressStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "approved";
export type UploadStatus = "parsing" | "needs_review" | "committed" | "discarded";
export type AttendanceStatus = "present" | "absent" | "traveled" | "excused";
export type AttendanceSource = "sheet_upload" | "manual";
export type WelfareReason = "new_member" | "missed_service" | "traveled" | "inactive";
export type WelfareStatus = "pending" | "in_progress" | "contacted" | "resolved";

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  location: string | null;
  whatsapp_number: string | null;
  avatar_url: string | null;
  member_status: MemberStatus;
  coc_completed: boolean;
  coc_completed_at: string | null;
  claimed: boolean;
  /** How they joined: self_signup | import | welfare */
  member_origin: string;
  birth_month: number | null;
  birth_day: number | null;
  created_at: string;
};

export type Subunit = {
  id: string;
  name: string;
  slug: string;
  category: SubunitCategory;
  description: string | null;
  created_at: string;
};

export type SubunitMember = {
  id: string;
  subunit_id: string;
  user_id: string;
  membership_type: MembershipType;
  role_in_subunit: RoleInSubunit;
  created_at: string;
};

export type Course = {
  id: string;
  subunit_id: string;
  title: string;
  description: string | null;
  created_by: string;
  is_published: boolean;
  created_at: string;
};

export type Module = {
  id: string;
  course_id: string;
  position: number;
  title: string;
  content_type: ContentType;
  content_url: string | null;
  content_urls: string[];
  content_body: string | null;
  created_at: string;
};

export type Assignment = {
  id: string;
  module_id: string;
  instructions: string;
  created_at: string;
};

export type Enrollment = {
  id: string;
  user_id: string;
  course_id: string;
  status: EnrollmentStatus;
  application_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export type ModuleProgress = {
  id: string;
  user_id: string;
  module_id: string;
  status: ModuleProgressStatus;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejection_note: string | null;
  created_at: string;
};

export type CodeOfConduct = {
  id: string;
  version: number;
  title: string;
  body: string;
  is_active: boolean;
  created_at: string;
};

export type CocQuestion = {
  id: string;
  question: string;
  options: string[];
  correct_option_index: number;
  is_active: boolean;
  created_at: string;
};

export type CocAttempt = {
  id: string;
  user_id: string;
  passed: boolean;
  score: number;
  total: number;
  attempted_at: string;
  created_at: string;
};

export type Activity = {
  id: string;
  name: string;
  day_of_week: string;
  time_of_day: string;
  is_attendance_signal: boolean;
  created_at: string;
};

export type AttendanceUpload = {
  id: string;
  uploaded_by: string;
  original_filename: string;
  raw_storage_path: string;
  activity_id: string;
  service_date: string;
  status: UploadStatus;
  ai_proposal: AiProposal | null;
  committed_at: string | null;
  created_at: string;
};

export type AttendanceRecord = {
  id: string;
  user_id: string;
  activity_id: string;
  service_date: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  upload_id: string | null;
  created_at: string;
};

export type MonthlyAttendanceSummary = {
  user_id: string;
  period: string; // 'YYYY-MM'
  count: number;
  created_at: string;
};

export type WelfareFollowup = {
  id: string;
  user_id: string;
  reason: WelfareReason;
  level: number;
  status: WelfareStatus;
  auto_flagged: boolean;
  notes: string | null;
  assigned_to: string | null;
  last_contact_at: string | null;
  created_at: string;
};

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

export type UserRole = {
  id: string;
  user_id: string;
  role: Role;
  created_at: string;
};

export type AppSetting = {
  key: string;
  value: unknown;
  updated_at: string;
};

/** Shape stored in attendance_uploads.ai_proposal (Section 12). */
export type AiProposal = {
  matches: {
    roster_id: string;
    name_on_sheet: string;
    status: AttendanceStatus;
    confidence: number;
  }[];
  unmatched_sheet_rows: {
    name_on_sheet: string;
    raw: string;
    status: string;
  }[];
  roster_not_on_sheet: {
    roster_id: string;
    full_name: string;
  }[];
};

type TableDef<T> = {
  Row: T;
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: TableDef<Profile>;
      user_roles: TableDef<UserRole>;
      subunits: TableDef<Subunit>;
      subunit_members: TableDef<SubunitMember>;
      courses: TableDef<Course>;
      modules: TableDef<Module>;
      assignments: TableDef<Assignment>;
      enrollments: TableDef<Enrollment>;
      module_progress: TableDef<ModuleProgress>;
      code_of_conduct: TableDef<CodeOfConduct>;
      coc_questions: TableDef<CocQuestion>;
      coc_attempts: TableDef<CocAttempt>;
      activities: TableDef<Activity>;
      attendance_uploads: TableDef<AttendanceUpload>;
      attendance_records: TableDef<AttendanceRecord>;
      monthly_attendance_summary: TableDef<MonthlyAttendanceSummary>;
      welfare_followups: TableDef<WelfareFollowup>;
      notifications: TableDef<Notification>;
      app_settings: TableDef<AppSetting>;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
