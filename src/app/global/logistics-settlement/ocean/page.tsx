import { redirect } from "next/navigation";

// The settlement console renders multiple carrier modes (해상/SEND/택배/그라운드),
// so the canonical route is the parent /global/logistics-settlement. Keep /ocean as a
// redirect so existing links and bookmarks still resolve.
export default function Page() {
  redirect("/global/logistics-settlement");
}
