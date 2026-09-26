import { isDeepStrictEqual } from 'node:util';
import { MessageFlags } from 'discord.js';
import { z } from 'zod';
import type { Locale, Membership, MembershipProvider } from '../contracts.js';
import type { InteractionPort } from '../discord/handler.js';
import { websiteOrigin } from '../website/client.js';
import {
  signupContextSchema,
  signupRequestSchema,
  signupResultSchema,
  type SignupCommand,
  type SignupRequest,
  type SignupWebsite,
} from './contracts.js';
export interface SignupDependencies {
  guildId: string;
  defaultLocale: Locale;
  websiteOrigin: string;
  membership: MembershipProvider;
  website: SignupWebsite;
  now?: () => Date;
}
const button = /^vlk:signup:(join|withdraw|mine):([a-fA-F0-9-]{36}):(cs|en)$/;
const membershipSchema = z
  .object({
    guildId: z.string(),
    userId: z.string(),
    state: z.literal('present'),
    roleIds: z.array(z.string().regex(/^[1-9][0-9]{16,19}$/)).max(250),
    observedAt: z.iso.datetime(),
  })
  .strict();
const copy = {
  cs: {
    invalid: 'Tato přihláška není platná. Otevřete aktuální zprávu zápasu.',
    unavailable: 'Přihlášky nyní nelze bezpečně ověřit. Zkuste to později nebo otevřete web.',
    denied: 'Pro tuto přihlášku nemáte ověřené oprávnění. Otevřete aktuální zápas na webu.',
    obsolete: 'Tato zpráva zápasu už není aktuální. Otevřete nejnovější zveřejněnou zprávu.',
    closed: 'Změny přihlášek jsou uzavřené nebo uzamčené. Stav můžete ověřit na webu.',
    unlinked: 'Nejprve propojte svůj účet přihlášením přes Discord na webu:',
    unknown:
      'Výsledek změny nelze ověřit. Zápis nebyl automaticky opakován. Nejprve zkontrolujte účast na webu nebo tlačítkem Moje účast.',
    joined: 'Web potvrdil vaše přihlášení do zápasu.',
    waitlisted: 'Web potvrdil zařazení na čekací listinu. Místo v sestavě zatím není přidělené.',
    withdrawn: 'Web potvrdil odhlášení ze zápasu.',
    mine: {
      none: 'Nejste přihlášeni.',
      joined: 'Vaše účast: přihlášeno.',
      waitlisted: 'Vaše účast: čekací listina.',
      withdrawn: 'Vaše účast: odhlášeno.',
    },
  },
  en: {
    invalid: 'This signup control is invalid. Open the current match message.',
    unavailable:
      'Signup eligibility cannot be verified safely right now. Try later or open the website.',
    denied:
      'You do not have verified eligibility for this signup. Open the current match on the website.',
    obsolete: 'This match message is no longer current. Open the latest published message.',
    closed: 'Signup changes are closed or locked. Check your participation on the website.',
    unlinked: 'First link your account by signing in with Discord on the website:',
    unknown:
      'The change outcome is unknown. It was not retried automatically. Check your participation on the website or with My participation before another change.',
    joined: 'The website confirmed your signup for this match.',
    waitlisted:
      'The website confirmed your place on the waiting list. A roster slot has not been assigned yet.',
    withdrawn: 'The website confirmed your withdrawal from the match.',
    mine: {
      none: 'Not signed up.',
      joined: 'Your participation: signed up.',
      waitlisted: 'Your participation: waiting list.',
      withdrawn: 'Your participation: withdrawn.',
    },
  },
} as const;
async function fresh(deps: SignupDependencies, request: SignupRequest): Promise<Membership> {
  const member = membershipSchema.parse(
    await deps.membership.fetch(request.guildId, request.userId),
  );
  const age = (deps.now?.() ?? new Date()).getTime() - Date.parse(member.observedAt);
  if (
    member.guildId !== request.guildId ||
    member.userId !== request.userId ||
    age < 0 ||
    age > 60_000 ||
    !Number.isFinite(age)
  )
    throw Error('membership_unavailable');
  return member;
}
/** Shared message controls remain intact: every reply and account detail is private to the actor. */
export async function handleSignup(port: InteractionPort, deps: SignupDependencies): Promise<void> {
  await port.deferReply({ flags: MessageFlags.Ephemeral });
  const match = port.input.kind === 'button' ? button.exec(port.input.customId) : null;
  const locale: Locale =
    match?.[3] === 'en' ? 'en' : match?.[3] === 'cs' ? 'cs' : deps.defaultLocale;
  const text = copy[locale];
  const reply = (content: string) =>
    port.editReply({ content, components: [], allowedMentions: { parse: [] } });
  const source = port.input.kind === 'button' ? port.input : undefined;
  const parsed = signupRequestSchema.safeParse({
    schemaVersion: 1,
    publicationId: match?.[2],
    locale,
    guildId: port.input.guildId,
    userId: port.input.userId,
    interactionId: port.input.id,
    channelId: source?.sourceChannelId,
    messageId: source?.sourceMessageId,
  });
  if (!match || !parsed.success || port.input.guildId !== deps.guildId) {
    await reply(text.invalid);
    return;
  }
  const request = parsed.data;
  let dispatched = false;
  let content: string;
  try {
    const origin = websiteOrigin(deps.websiteOrigin);
    const member = await fresh(deps, request);
    const context = signupContextSchema.parse(await deps.website.context(request));
    if (!isDeepStrictEqual(context.request, request)) throw Error('context_identity');
    const account = `${origin}/${locale}/account`;
    if (context.state !== 'ready')
      content =
        context.state === 'unlinked'
          ? `${text.unlinked} ${account}`
          : context.state === 'obsolete'
            ? text.obsolete
            : text.denied;
    else if (match[1] === 'mine') content = text.mine[context.participation];
    else if (context.signup !== 'open') content = text.closed;
    else {
      const current = await fresh(deps, request);
      if (
        !isDeepStrictEqual(
          [...new Set(member.roleIds)].sort(),
          [...new Set(current.roleIds)].sort(),
        )
      )
        throw Error('membership_changed');
      const command: SignupCommand = {
        ...request,
        action: match[1] === 'join' ? 'join' : 'withdraw',
        expectedRevision: context.revision,
        idempotencyKey: `${request.guildId}:${request.userId}:${request.interactionId}`,
      };
      dispatched = true;
      const result = signupResultSchema.parse(await deps.website.participate(command));
      if (!isDeepStrictEqual(result.command, command)) throw Error('result_identity');
      if (result.status === 'committed')
        content =
          result.participation === 'joined'
            ? text.joined
            : result.participation === 'waitlisted'
              ? text.waitlisted
              : text.withdrawn;
      else if (result.reason === 'unlinked') content = `${text.unlinked} ${account}`;
      else if (result.reason === 'closed' || result.reason === 'locked') content = text.closed;
      else if (result.reason === 'ineligible') content = text.denied;
      else content = text.obsolete;
    }
  } catch {
    content = dispatched ? text.unknown : text.unavailable;
  }
  // Delivery failures must propagate; they must never repeat or reinterpret a committed write.
  await reply(content);
}
