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
