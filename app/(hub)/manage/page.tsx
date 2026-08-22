import { redirect } from "next/navigation";

/** Portfolio Manager moved to the app root. Keeps existing links working. */
export default function ManageRedirect() {
  redirect("/");
}
