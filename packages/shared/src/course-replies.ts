export const MAX_COURSE_REPLY_BATCH = 20;

export type CourseReplyTarget = {
  conversationId: string;
  expectedMessageId: string | null;
};

export type CourseReplyRequest = {
  productId: string;
  unansweredOnly: boolean;
  targets: CourseReplyTarget[];
};

export type CourseReplyResult = {
  conversationId: string;
  status: "QUEUED" | "ALREADY_QUEUED" | "SKIPPED";
  reason?: string;
};
