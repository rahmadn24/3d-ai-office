import { listDivisions } from "@/lib/status";
import ChatBox from "./ChatBox";

export const dynamic = "force-dynamic";

export default function Ngobrol() {
  const divisions = listDivisions();
  return (
    <main>
      <h1>Ngobrol <small>· ketik `jadi sari` versi visual — pilih manajer, kasih tugas, atau panggil ke meeting room</small></h1>
      <p><small><a href="/dashboard">← dashboard</a> · <a href="/kantor">kantor 3D →</a></small></p>
      <ChatBox divisions={divisions.map((d) => ({ ...d }))} />
    </main>
  );
}
