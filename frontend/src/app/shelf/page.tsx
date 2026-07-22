import { redirect } from "next/navigation";

export default function ShelfPage(): never {
  redirect("/shelf/photos");
}
