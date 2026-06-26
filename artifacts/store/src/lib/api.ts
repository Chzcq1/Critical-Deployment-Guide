export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  fake_discount_price: number | null;
  image_url: string | null;
  telegram_group_ids: string;
  is_active: boolean;
}

export interface Order {
  id: string;
  telegram_user_id: number;
  telegram_username: string;
  telegram_first_name: string;
  product_id: string;
  product_name: string;
  payment_type: "slip" | "truemoney";
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

const API_URL = "/api";

export const api = {
  // Public
  getProducts: async (): Promise<Product[]> => {
    const res = await fetch(`${API_URL}/products`);
    if (!res.ok) throw new Error("Failed to fetch products");
    return res.json();
  },

  submitOrder: async (data: {
    telegram_user_id: number;
    telegram_username: string;
    telegram_first_name: string;
    product_id: string;
    payment_proof: string;
    payment_type: string;
  }): Promise<void> => {
    const res = await fetch(`${API_URL}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to submit order");
  },

  verifyTelegramAuth: async (data: any): Promise<void> => {
    const res = await fetch(`${API_URL}/auth/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to verify telegram auth");
  },

  // Admin
  requestOtp: async (telegram_id: number): Promise<void> => {
    const res = await fetch(`${API_URL}/admin/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id }),
    });
    if (!res.ok) throw new Error("Failed to request OTP");
  },

  verifyOtp: async (telegram_id: number, otp_code: string): Promise<{ access_token: string }> => {
    const res = await fetch(`${API_URL}/admin/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id, otp_code }),
    });
    if (!res.ok) throw new Error("Failed to verify OTP");
    return res.json();
  },

  getAdminProducts: async (token: string): Promise<Product[]> => {
    const res = await fetch(`${API_URL}/admin/products`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to fetch admin products");
    return res.json();
  },

  createProduct: async (token: string, product: Partial<Product>): Promise<Product> => {
    const res = await fetch(`${API_URL}/admin/products`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(product),
    });
    if (!res.ok) throw new Error("Failed to create product");
    return res.json();
  },

  updateProduct: async (token: string, id: string, product: Partial<Product>): Promise<Product> => {
    const res = await fetch(`${API_URL}/admin/products/${id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(product),
    });
    if (!res.ok) throw new Error("Failed to update product");
    return res.json();
  },

  deleteProduct: async (token: string, id: string): Promise<void> => {
    const res = await fetch(`${API_URL}/admin/products/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to delete product");
  },

  getAdminOrders: async (token: string): Promise<Order[]> => {
    const res = await fetch(`${API_URL}/admin/orders`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to fetch admin orders");
    return res.json();
  },
};
