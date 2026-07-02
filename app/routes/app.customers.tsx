import { Outlet } from "@remix-run/react";

/** /app/customers layout — hosts list (_index) and detail ($id) routes. */
export default function CustomersLayout() {
  return <Outlet />;
}
