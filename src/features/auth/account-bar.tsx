import { Button } from "../../components/button.tsx";

type AccountBarProps = {
  phoneNumber: string;
  signOutAction: () => Promise<void>;
};

export function AccountBar({ phoneNumber, signOutAction }: AccountBarProps) {
  return (
    <header className="ui-account">
      <p className="ui-account-phone">
        <span className="ui-account-label">Account</span>{" "}
        <bdi dir="ltr">{phoneNumber}</bdi>
      </p>
      <form action={signOutAction}>
        <Button type="submit" variant="secondary">
          Log out
        </Button>
      </form>
    </header>
  );
}
