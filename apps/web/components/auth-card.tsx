import { CoachPreview } from "@/components/coach-preview";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="grid items-center gap-12 lg:min-h-[calc(100dvh-11.5rem-1px)] lg:grid-cols-2">
      <Card className="mx-auto w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
        {footer ? (
          <CardFooter className="text-sm text-muted-foreground">
            {footer}
          </CardFooter>
        ) : null}
      </Card>
      <div className="hidden justify-center lg:flex">
        <CoachPreview />
      </div>
    </div>
  );
}
