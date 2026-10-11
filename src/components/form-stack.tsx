import type { FormEvent, ReactNode } from "react";

type FormStackProps = {
  children: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function FormStack({ children, onSubmit }: FormStackProps) {
  return (
    <form className="ui-form" noValidate onSubmit={onSubmit}>
      {children}
    </form>
  );
}
