import { Brain } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Section } from "@/components/section";
import { ModelListContainer } from "./_components/model-list-container";

export const dynamic = "force-dynamic";

export default async function DashboardModelsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "models" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("description")}</p>
      </div>

      <Section
        title={t("section.title")}
        description={t("section.description")}
        icon="brain"
        iconColor="text-purple-500"
      >
        <ModelListContainer />
      </Section>
    </div>
  );
}
