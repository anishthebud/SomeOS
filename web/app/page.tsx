import { LoginGate } from "@/components/LoginGate";
import { SomeOSApp } from "@/components/someos/SomeOSApp";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <LoginGate>
      <SomeOSApp />
    </LoginGate>
  );
}
