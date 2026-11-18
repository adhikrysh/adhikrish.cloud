// The tab registry: the one place that says what each tab holds.
// Adding a tab = one entry here + one migration in migrations/ that creates its table.
// The api, the page and the csv import all read this.

export type FieldType = "text" | "int";
export type Field = { name: string; type: FieldType; required?: boolean };
export type Tab = {
  slug: string; // url segment and table name
  label: string; // shown on the page
  about: string; // one line on the home page
  sheet: string; // the google sheet tab it was imported from
  fields: Field[];
  // How a row reads in the list: a title, a short right-hand note, and a muted line below.
  title: string;
  aside: string[];
  line: string[];
};

const text = (name: string, required = false): Field => ({ name, type: "text", required });
const int = (name: string): Field => ({ name, type: "int" });

export const TABS: Tab[] = [
  {
    slug: "people",
    label: "people",
    about: "people i've met, and where",
    sheet: "ppl-index",
    fields: [text("name", true), text("email"), text("company"), text("title"), text("met_where"), text("met_date"),
      text("location"), text("linkedin"), text("twitter"), text("referred_by"), text("notes"), text("added_date")],
    title: "name",
    aside: ["met_date"],
    line: ["company", "title", "met_where"],
  },
  {
    slug: "outbound",
    label: "outbound",
    about: "cold outreach and who replied",
    sheet: "cold-outbounds",
    fields: [text("name", true), text("person_context"), text("platform"), text("reason"), text("message"), text("replied"),
      text("follow_up"), text("remarks"), text("email"), text("sent_date"), text("status"), text("last_comment")],
    title: "name",
    aside: ["status", "sent_date"],
    line: ["platform", "reason"],
  },
  {
    slug: "forecasts",
    label: "forecasts",
    about: "predictions to be scored later",
    sheet: "superforecasting",
    fields: [text("date"), text("decision", true), text("rationale"), text("confidence"), text("expected"),
      text("review_date"), text("outcome"), text("verdict"), text("status")],
    title: "decision",
    aside: ["confidence", "status"],
    line: ["review_date", "verdict"],
  },
  {
    slug: "gym",
    label: "gym",
    about: "training sessions",
    sheet: "gym-sessions",
    fields: [text("date", true), text("type"), text("title"), text("summary"), int("duration_min"), int("rpe"), text("feel")],
    title: "title",
    aside: ["date"],
    line: ["type", "duration_min", "rpe"],
  },
];

export const tabBySlug = new Map(TABS.map((tab) => [tab.slug, tab]));

/** Columns every table has, managed by the server, never written by clients. */
export const SYSTEM_FIELDS = ["id", "created_at", "updated_at", "updated_by"] as const;
