import { describe, it, expect } from "vitest";
import { emailEstConfigure, enProduction, masquerCourriel } from "./email";

describe("emailEstConfigure — l'app ne promet un envoi que si elle peut le tenir", () => {
  it("Resend sans RESEND_FROM en production = NON configuré (les écrans retombent sur Gmail/mailto)", () => {
    expect(emailEstConfigure({ RESEND_API_KEY: "re_x", VERCEL: "1" } as any)).toBe(false);
    expect(emailEstConfigure({ RESEND_API_KEY: "re_x", NODE_ENV: "production" } as any)).toBe(false);
  });

  it("Resend avec RESEND_FROM en production = configuré", () => {
    expect(emailEstConfigure({ RESEND_API_KEY: "re_x", RESEND_FROM: "contrats@revetementviking.com", VERCEL: "1" } as any)).toBe(true);
  });

  it("hors production, la clé Resend suffit (expéditeur d'essai toléré)", () => {
    expect(emailEstConfigure({ RESEND_API_KEY: "re_x", NODE_ENV: "development" } as any)).toBe(true);
  });

  it("Gmail SMTP reste un fournisseur à part entière ; rien du tout = non configuré", () => {
    expect(emailEstConfigure({ GMAIL_USER: "x@gmail.com", GMAIL_APP_PASSWORD: "abcd", VERCEL: "1" } as any)).toBe(true);
    expect(emailEstConfigure({} as any)).toBe(false);
  });

  it("enProduction et masquerCourriel", () => {
    expect(enProduction({ VERCEL: "1" } as any)).toBe(true);
    expect(enProduction({ NODE_ENV: "test" } as any)).toBe(false);
    expect(masquerCourriel("julie@exemple.ca")).toBe("j***@exemple.ca");
  });
});
