import { History } from "../../components/History";
import { Chat } from "./Chat";

export default function GUI() {
  return (
    <div className="flex h-screen w-screen flex-row overflow-hidden">
      <aside className="4xl:flex border-vsc-input-border no-scrollbar hidden h-full w-96 overflow-y-auto border-0 border-r border-solid">
        <History />
      </aside>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Chat />
      </main>
    </div>
  );
}
