import { Outlet } from "@remix-run/react";

/** /app/customers layout — liste (_index) ve detay ($id) sayfalarını barındırır. */
export default function CustomersLayout() {
  return <Outlet />;
}
