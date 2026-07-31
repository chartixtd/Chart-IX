// ==================== 用户 ====================
export type UserRole = "user" | "admin";
export type UserTier = "free" | "pro";
export type Locale = "zh-CN" | "en-US" | "ms-MY";

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  tier: UserTier;
  language: Locale;
  is_disabled: boolean;
  disabled_at: string | null;
  disabled_reason: string | null;
  pro_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ==================== 视频 ====================
export interface Video {
  id: string;
  title: Record<Locale, string>;
  description: Record<Locale, string> | null;
  category_id: number | null;
  category?: VideoCategory;
  /** 该视频所属语言，仅在对应语言的前台页面展示 */
  language: Locale;
  storage_url: string;
  thumbnail_url: string | null;
  duration_seconds: number;
  file_size_bytes: number | null;
  tier_required: UserTier;
  view_count: number;
  sort_order: number;
  is_deleted: boolean;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VideoCategory {
  id: number;
  name: Record<Locale, string>;
  slug: string;
  sort_order: number;
}

// ==================== 学习路径 ====================
export interface LearningPath {
  id: number;
  slug: string;
  title: Record<Locale, string>;
  description: Record<Locale, string> | null;
  cover_image: string | null;
  level: "beginner" | "intermediate" | "advanced";
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface LearningPathStep {
  id: number;
  path_id: number;
  video_id: string;
  sort_order: number;
  created_at: string;
  video?: Video;
}

// ==================== 小测 ====================
export interface Quiz {
  id: number;
  video_id: string;
  title: Record<Locale, string>;
  created_at: string;
}

export interface QuizQuestion {
  id: number;
  quiz_id: number;
  question: Record<Locale, string>;
  options: Record<Locale, string[]>;
  correct_index: number;
  sort_order: number;
}

export interface QuizAttempt {
  id: string;
  user_id: string;
  quiz_id: number;
  score: number;
  total: number;
  passed: boolean;
  created_at: string;
}

// ==================== 成就 ====================
export interface Achievement {
  key: string;
  title: Record<Locale, string>;
  description: Record<Locale, string> | null;
  icon: string;
  sort_order: number;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_key: string;
  earned_at: string;
  achievement?: Achievement;
}

export interface VideoProgress {
  id: string;
  user_id: string;
  video_id: string;
  progress_seconds: number;
  completed: boolean;
  completed_at: string | null;
  updated_at: string;
}

// ==================== 文章 ====================
export interface Article {
  id: string;
  slug: string;
  title: Record<Locale, string>;
  content: Record<Locale, string>;
  category_id: number | null;
  category?: ArticleCategory;
  cover_image: string | null;
  author_id: string;
  tier_required: UserTier;
  view_count: number;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArticleCategory {
  id: number;
  name: Record<Locale, string>;
  slug: string;
  sort_order: number;
}

// ==================== 交易 ====================
export type MarketType = "spot" | "futures";
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop_loss" | "take_profit" | "stop_market";
export type OrderStatus =
  | "pending"
  | "filled"
  | "partially_filled"
  | "canceled"
  | "rejected"
  | "expired";

// ==================== 模拟盘 ====================
export interface PaperAccount {
  id: string;
  user_id: string;
  balance_usdt: number;
  created_at: string;
  updated_at: string;
}

export type PositionSide = "long" | "short";

export interface PaperPosition {
  id: string;
  account_id: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entry_price: number;
  leverage: number;
  margin: number;
  liquidation_price: number;
  take_profit_price: number | null;
  stop_loss_price: number | null;
  updated_at: string;
}

export interface PaperOrder {
  id: string;
  account_id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  total_value: number;
  realized_pnl: number | null;
  balance_after: number;
  leverage: number;
  margin: number;
  created_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  label: string;
  api_key_preview: string;
  is_valid: boolean;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  user_id: string;
  market_type: MarketType;
  symbol: string;
  side: OrderSide;
  order_type: OrderType;
  quantity: number;
  price: number | null;
  stop_price: number | null;
  leverage: number;
  status: OrderStatus;
  bingx_order_id: string | null;
  executed_qty: number | null;
  executed_price: number | null;
  total_value: number | null;
  fee: number | null;
  fee_asset: string | null;
  error_message: string | null;
  risk_rejected: boolean;
  risk_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ==================== Admin ====================
export interface FeatureFlag {
  id: number;
  feature_key: string;
  feature_group: string;
  display_name: Record<Locale, string>;
  description: Record<Locale, string> | null;
  free_enabled: boolean;
  pro_enabled: boolean;
  updated_at: string;
}

export interface PricingConfig {
  id: number;
  plan_type: "monthly" | "yearly";
  price: number;
  original_price: number | null;
  currency: string;
  currency_symbol: string;
  is_active: boolean;
  updated_at: string;
}

export interface AdminSetting {
  id: number;
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}

export interface AdminLog {
  id: string;
  admin_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  old_value: unknown;
  new_value: unknown;
  ip_address: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_type: "monthly" | "yearly";
  payment_method: string | null;
  payment_tx_hash: string | null;
  amount_paid: number | null;
  currency_paid: string | null;
  status: "active" | "expired" | "canceled" | "refunded";
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}

// ==================== API 通用响应 ====================
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  pagination?: Pagination;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ==================== 交易面板 ====================
export interface Ticker {
  symbol: string;
  price: string;
  change_24h: string;
  change_percent_24h: string;
  high_24h: string;
  low_24h: string;
  volume_24h: string;
}

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
}

export interface Position {
  symbol: string;
  position_side: "long" | "short";
  quantity: number;
  entry_price: number;
  mark_price: number;
  unrealized_pnl: number;
  realized_pnl: number;
  leverage: number;
  liquidation_price: number;
  margin: number;
}
