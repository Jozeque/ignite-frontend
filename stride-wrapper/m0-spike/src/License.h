#pragma once
// ============================================================================
// Stride VST3 license — mirrors the desktop app's gate (stride-vst/app/main.js)
// 1:1 so a SINGLE purchase covers desktop + plugin:
//   1. built-in master/ambassador key SHA-256 hashes (offline, instant)
//   2. backend proxy to Lemon Squeezy (covers every paying customer)
//   3. 14-day offline grace from the cached result
// Activation is SHARED with the desktop: same license.json in the same folder,
// so an already-activated desktop user is auto-unlocked in the plugin.
// ============================================================================
#include <juce_core/juce_core.h>
#include <juce_cryptography/juce_cryptography.h>
#include <functional>
#include <cstdint>
#include <monocypher-ed25519.h>   // standard Ed25519 (SHA-512) verify — src/third_party/monocypher

namespace stride_license
{
    inline constexpr const char* kEndpoint = "https://generate-midi-z3spyrafvq-uc.a.run.app";
    inline constexpr int kOfflineGraceDays = 14;

    // Shared with the desktop Electron app (userData = .../stride-canvas).
    inline juce::File dataDir()
    {
        return juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
                 .getChildFile ("stride-canvas").getChildFile ("stride-data");
    }
    inline juce::File licenseFile() { return dataDir().getChildFile ("license.json"); }

    // Anti-rollback clock for the time-limited Discovery Pass. A SEPARATE file (not
    // license.json, which is rewritten wholesale on every revalidation and would clobber
    // this). Holds the highest real-time the machine has ever observed; the pass expiry is
    // checked against max(now, maxSeen) so setting the system clock back can't revive it.
    // Only ever consulted for exp-bearing passes — perpetual keys never read it.
    inline juce::File passClockFile() { return dataDir().getChildFile ("pass-clock.json"); }
    inline juce::int64 passClockMaxSeen()
    {
        const auto f = passClockFile();
        if (! f.existsAsFile()) return 0;
        return (juce::int64) juce::JSON::parse (f.loadFileAsString()).getProperty ("maxSeen", (juce::int64) 0);
    }
    // Monotonic raise (never lowers). `trusted` = the unforgeable server time (validate/start_pass);
    // untrusted = the local launch clock. To avoid BRICKING a machine whose clock is wildly wrong
    // (dead CMOS -> year 2099) or a MITM'd server time, we (a) bootstrap the clock ONLY from a
    // trusted source, and (b) clamp any single raise to +5 days, so an absurd clock can never
    // poison maxSeen far into the future (which would pre-expire every current/future credential).
    // The live expiry check uses jmax(realNow, maxSeen), so a clamped floor never wrongly extends.
    inline void raisePassClock (juce::int64 ms, bool trusted)
    {
        if (ms <= 0) return;
        const auto cur = passClockMaxSeen();
        if (cur <= 0 && ! trusted) return;                                  // don't bootstrap off the local clock
        const juce::int64 kMaxJumpMs = (juce::int64) 5 * 24 * 60 * 60 * 1000;
        if (cur > 0 && ms > cur + kMaxJumpMs) ms = cur + kMaxJumpMs;        // clamp absurd forward jumps
        if (ms <= cur) return;
        dataDir().createDirectory();
        juce::DynamicObject::Ptr o = new juce::DynamicObject();
        o->setProperty ("maxSeen", ms);
        passClockFile().replaceWithText (juce::JSON::toString (juce::var (o.get())));
    }

    inline juce::String shaUpper (const juce::String& key)
    {
        const auto u = key.trim().toUpperCase();
        return juce::SHA256 (u.toRawUTF8(), (size_t) u.getNumBytesAsUTF8()).toHexString();
    }

    // Stable, privacy-safe per-machine id for the Discovery Pass one-device gate. The OS
    // unique id is salted + SHA-256'd IN THE CLIENT, so the raw machine id never leaves the
    // device — only this opaque hash is sent. Falls back to computer+user name if the OS id
    // is unavailable. Used as both the sent `device` and the cached pass key.
    inline juce::String deviceHash()
    {
        auto id = juce::SystemStats::getUniqueDeviceID().trim();
        if (id.isEmpty()) id = juce::SystemStats::getComputerName() + "|" + juce::SystemStats::getLogonName();
        return shaUpper (juce::String ("stride-pass-v1|") + id);
    }

    // SHA-256 of the built-in keys (originals never shipped) — copied from main.js.
    inline juce::var builtinCheck (const juce::String& key)
    {
        static const char* hashes[] = {
            "074ac7dc594a379be6e5bdfbaab4d16d5400a19cc2f2af9f8c83e88612efdb62", // master
            "f6485506181c07fc0c1513f18de67be3c06828b94d1dd1cdf5bcc1196ad40bb9",
            "44e1f552ff072c6f1da59c74027aec8f10c2dedd9112059b34db01a30f37ed3c",
            "858d56da08c740df788f7897938d9f8059261aae942036eeaac52a0831dcecd4",
            "11837c8ab57deb3cd307fa7f2ad9eeaafdd31d9c7670dcfaa041b13a08d57dfb",
            "1076e40ca485c754409c235f658f7dc4397f2a89320f4b109bbfda3ada531bb2",
            "0333a6cb94d67b15cdd146a08a202de830018d8ea573adf73bb152d790848053",
            "fe9eb70e860352f000a56d9d63fce7effdbf589c05504e4c1d59ee15b1bad6ea",
            "0474f1fb9cf93ab2b53f10ca69b9c095bd84aff6ba06c8f99ae132ac9244ef65",
            "6434242c08eb442f27c68ddb23d471f6e43b01159b73ac2e4f5cc2d1dbf48681",
            "934fb5c23d1285b79f32e0458ac50ad99b1a0a0c67029b2c47edfa8533fb5b54",
            "796d3cf2bb41c7bb5682143ee0b2bf3e0a910e51194b8195c5215a6ad0bcde20",
            "afe99867541df34bce675d0d5a44b585556396cd21438987337ee69bcb2a8a42",
            "36129c1682dd13bfb260b28545a4e4ce03371e425bdd05a3c3fc8b35df414369",
            "e1ba03fa1978ddb39e186a9ed6c65b7969f90d3c2a3badec94e3a96269551a21",
            "a3fcd7166cec022bd629cd408c81999d95b22f99a5111d7665da1ae091f79b7e",
            "967f5404c56687f0fd7cbcdde0d47d694d3cfc0e9a60b55aa207575e63eead7c",
            "1e9f68e8e33345bc9496efb17f0ff60aefa0a410cc99204ec3e7695c7bc07f96",
            "28082797a73f7c2b16c6e625898d4b69617f4602dee9306a1ce10881782de72a",
            "ff2fce5c727259e4b596ed3e9a8a7a89f31c86c65051da1676ae262aefba6474",
            "18bf914c5d3b4fa50b15bd7fdb41af741726359d9d2623186c72aba3d68ef4df"
        };
        const auto h = shaUpper (key);
        for (int i = 0; i < (int) (sizeof (hashes) / sizeof (hashes[0])); ++i)
            if (h == hashes[i])
            {
                auto* o = new juce::DynamicObject();
                o->setProperty ("valid", true);
                o->setProperty ("tier", i == 0 ? "master" : "ambassador");
                o->setProperty ("customer_name", i == 0 ? "Master" : ("Ambassador #" + juce::String (i)));
                o->setProperty ("builtin", true);
                o->setProperty ("entitled", true);   // built-in keys unlock every product
                juce::Array<juce::var> allEnts; allEnts.add ("stridelink"); allEnts.add ("vst");
                o->setProperty ("entitlements", allEnts);
                return juce::var (o);
            }
        return {};
    }

    // ── Product-scoped entitlements (docs/stride-entitlements-spec.md) ──
    // The server signs {key,ents,iat} with Ed25519; we VERIFY with the embedded
    // PUBLIC key (raw 32 bytes, extracted from the SPKI PEM). This IS the VST, so
    // we gate on the "vst" entitlement and do NOT grandfather a legacy unsigned
    // cache (grandfatherProduct=null in the JS mirror) — a v1 cache forces an
    // online re-scope. Mirrors entitlements.js readEntitlement 1:1.
    static const uint8_t kEntPublicKey[32] = {
        0x4f, 0x27, 0x66, 0x14, 0xed, 0x9c, 0x11, 0xbb, 0x8d, 0xbb, 0x88, 0x10, 0x96, 0xc0, 0x90, 0x99,
        0xe0, 0x92, 0x82, 0x1a, 0x93, 0xf2, 0x40, 0x6b, 0xd9, 0x5a, 0x0b, 0xa0, 0x13, 0xdb, 0x86, 0xbd
    };

    inline juce::String entJsonEscape (const juce::String& s)
    {
        juce::String o;
        for (auto ch : s)
        {
            if (ch == '"')       o << "\\\"";
            else if (ch == '\\') o << "\\\\";
            else                 o << juce::String::charToString (ch);
        }
        return o;
    }

    // Reproduce entitlements.js canonicalize({key,ents,iat[,exp]}) byte-for-byte:
    //   {"ents":[...],"exp":<int>?,"iat":<int>,"key":"<escaped>"}   sorted keys, no spaces.
    // exp is OPTIONAL (only the time-limited Discovery Pass carries it). It sorts
    // alphabetically between "ents" and "iat" and is emitted ONLY when present, so a
    // perpetual key (no exp) produces the SAME bytes it was signed over — its Ed25519
    // signature keeps verifying. Emitting exp unconditionally would break every key.
    inline juce::String entCanonical (const juce::var& ent)
    {
        juce::String out = "{\"ents\":[";
        if (auto* arr = ent.getProperty ("ents", juce::var()).getArray())
            for (int i = 0; i < arr->size(); ++i)
            {
                if (i) out << ",";
                out << "\"" << entJsonEscape ((*arr)[i].toString()) << "\"";
            }
        out << "]";
        if (ent.hasProperty ("exp"))
            out << ",\"exp\":" << juce::String ((juce::int64) ent.getProperty ("exp", (juce::int64) 0));
        out << ",\"iat\":" << juce::String ((juce::int64) ent.getProperty ("iat", (juce::int64) 0))
            << ",\"key\":\"" << entJsonEscape (ent.getProperty ("key", "").toString()) << "\"}";
        return out;
    }

    inline bool entVerify (const juce::var& ent, const juce::String& sigB64)
    {
        juce::MemoryOutputStream sig;
        if (! juce::Base64::convertFromBase64 (sig, sigB64)) return false;
        if (sig.getDataSize() != 64) return false;
        const auto canon = entCanonical (ent);
        return crypto_ed25519_check ((const uint8_t*) sig.getData(),
                                     kEntPublicKey,
                                     (const uint8_t*) canon.toRawUTF8(),
                                     (size_t) canon.getNumBytesAsUTF8()) == 0;
    }

    // {entitled:bool, entitlement_reason:string}. product='vst', grandfather=null.
    // Grace is enforced by the callers (validate offline gate + the JS gate's
    // age<OFFLINE_GRACE_MS), so this stays time-independent.
    inline juce::var computeEntitled (const juce::var& lic)
    {
        auto mk = [] (bool ok, const char* reason)
        {
            auto* o = new juce::DynamicObject();
            o->setProperty ("entitled", ok);
            o->setProperty ("entitlement_reason", reason);
            return juce::var (o);
        };
        if (! lic.isObject())                          return mk (false, "no-license");
        if (! (bool) lic.getProperty ("valid", false)) return mk (false, "not-valid");
        // SECURITY: a stored "builtin":true is NOT trusted on its own — license.json is a
        // plaintext, user-writable file, so anyone could forge that flag for a free unlock.
        // Re-derive it: the stored key must actually hash to one of the built-in key hashes.
        // A legitimate built-in key re-hashes correctly (no behaviour change); a forged flag
        // with any other/absent key falls through to the signature path and is rejected.
        if ((bool) lic.getProperty ("builtin", false))
        {
            if (builtinCheck (lic.getProperty ("key", "").toString()).isObject())
                return mk (true, "builtin");
            return mk (false, "forged-builtin");
        }

        const auto ent = lic.getProperty ("ent", juce::var());
        const auto sig = lic.getProperty ("ent_sig", "").toString();
        if (ent.isObject() && sig.isNotEmpty())
        {
            if (! entVerify (ent, sig)) return mk (false, "bad-signature");
            const auto ka = ent.getProperty ("key", "").toString().trim().toUpperCase();
            const auto kb = lic.getProperty ("key", "").toString().trim().toUpperCase();
            if (ka != kb) return mk (false, "key-mismatch");
            bool hasVst = false;
            if (auto* arr = ent.getProperty ("ents", juce::var()).getArray())
                for (auto& e : *arr)
                    if (e.toString() == "vst") { hasVst = true; break; }
            if (! hasVst) return mk (false, "wrong-product");
            // Time-limited Discovery Pass: exp>0 means deny once we're past it. The effective
            // clock is max(now, maxSeen) so rolling the system clock back can't revive an
            // expired pass. A perpetual key has NO exp -> skipped entirely (unchanged).
            const juce::int64 exp = (juce::int64) ent.getProperty ("exp", (juce::int64) 0);
            if (exp > 0)
            {
                // DEVICE BINDING: a pass's signed ent.key IS the machine's device hash. A pass
                // minted for another device (a curl'd token, or a license.json copied off another
                // machine) won't match THIS device -> denied. This is what makes "one machine, one
                // pass" real on the client, even though the mint endpoint trusts a client string.
                // (Perpetual keys skip this — their key is the LS license key, not a device hash.)
                if (ka != deviceHash().toUpperCase()) return mk (false, "wrong-device");
                const juce::int64 eff = juce::jmax (juce::Time::getCurrentTime().toMilliseconds(), passClockMaxSeen());
                if (eff >= exp) return mk (false, "exp-expired");
            }
            return mk (true, "signed");
        }
        return mk (false, "v1-needs-online");   // VST never grandfathers a legacy cache
    }

    // {success:true, license:<obj|null>}
    inline juce::var load()
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("success", true);
        const auto f = licenseFile();
        if (f.existsAsFile())
        {
            auto parsed = juce::JSON::parse (f.loadFileAsString());
            if (auto* lo = parsed.getDynamicObject())
            {
                const auto e = computeEntitled (parsed);
                lo->setProperty ("entitled", (bool) e.getProperty ("entitled", false));
                lo->setProperty ("entitlement_reason", e.getProperty ("entitlement_reason", juce::var()));
                o->setProperty ("license", parsed);
            }
            else o->setProperty ("license", juce::var());
        }
        else o->setProperty ("license", juce::var());
        return juce::var (o);
    }

    // Best-effort "is this machine entitled to the VST right now?" for the NATIVE demo
    // gates (offline bounce / save) that must be correct even with the UI closed. Reads
    // the cached license.json, enforces the offline grace, and reuses computeEntitled.
    // Fail-safe: false (= demo) on any doubt. The UI's checkLicense() is the authority and
    // pushes the live value via setDemoMode; this is only the construction-time seed.
    inline bool cachedEntitled()
    {
        const auto f = licenseFile();
        if (! f.existsAsFile()) return false;
        const auto c = juce::JSON::parse (f.loadFileAsString());
        if (! c.isObject() || ! (bool) c.getProperty ("valid", false)) return false;
        if (! (bool) c.getProperty ("builtin", false))   // builtin keys have no grace clock
        {
            const auto cachedAt = (juce::int64) c.getProperty ("cached_at", (juce::int64) 0);
            const auto ageMs = juce::Time::getCurrentTime().toMilliseconds() - cachedAt;
            if (! (cachedAt > 0 && ageMs < (juce::int64) kOfflineGraceDays * 24 * 60 * 60 * 1000)) return false;
        }
        return (bool) computeEntitled (c).getProperty ("entitled", false);
    }

    // True ONLY for a genuinely-signed VST pass whose exp has passed (soft-lock trigger).
    // Paid keys (no exp), builtin keys, forged flags, and active passes all return false —
    // so the lock can't be faked, and a perpetual license never trips it.
    inline bool cachedExpiredPass()
    {
        const auto f = licenseFile();
        if (! f.existsAsFile()) return false;
        const auto c = juce::JSON::parse (f.loadFileAsString());
        if (! c.isObject() || ! (bool) c.getProperty ("valid", false)) return false;
        if ((bool) c.getProperty ("builtin", false)) return false;
        const auto ent = c.getProperty ("ent", juce::var());
        const auto sig = c.getProperty ("ent_sig", "").toString();
        if (! ent.isObject() || sig.isEmpty() || ! entVerify (ent, sig)) return false;
        const auto ka = ent.getProperty ("key", "").toString().trim().toUpperCase();
        if (ka != c.getProperty ("key", "").toString().trim().toUpperCase()) return false;
        if (ka != deviceHash().toUpperCase()) return false;   // device-bound: a copied expired pass gives no soft-lock/drive here
        bool hasVst = false;
        if (auto* arr = ent.getProperty ("ents", juce::var()).getArray())
            for (auto& e : *arr) if (e.toString() == "vst") { hasVst = true; break; }
        if (! hasVst) return false;
        const juce::int64 exp = (juce::int64) ent.getProperty ("exp", (juce::int64) 0);
        if (exp <= 0) return false;   // perpetual — never "expired"
        return juce::jmax (juce::Time::getCurrentTime().toMilliseconds(), passClockMaxSeen()) >= exp;
    }

    inline juce::var save (const juce::var& lic)
    {
        dataDir().createDirectory();
        juce::DynamicObject::Ptr out = new juce::DynamicObject();
        if (auto* in = lic.getDynamicObject())
            for (auto& p : in->getProperties()) out->setProperty (p.name, p.value);
        out->setProperty ("cached_at", juce::Time::getCurrentTime().toMilliseconds());   // ms, matches Date.now()
        licenseFile().replaceWithText (juce::JSON::toString (juce::var (out.get())));
        auto* r = new juce::DynamicObject(); r->setProperty ("success", true);
        return juce::var (r);
    }

    inline juce::var invalid (const juce::String& err)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("valid", false);
        o->setProperty ("error", err);
        o->setProperty ("builtin", false);
        return juce::var (o);
    }

    // builtin → reply immediately; else POST to the backend on a worker thread and
    // reply on the message thread. Mirrors validate-license-key in main.js.
    inline void validate (const juce::String& key, std::function<void (juce::var)> reply)
    {
        const auto upper = key.trim().toUpperCase();
        if (upper.isEmpty()) { reply (invalid ("Empty key")); return; }

        const auto b = builtinCheck (upper);
        if (b.isObject()) { reply (std::move (b)); return; }

        juce::Thread::launch ([upper, reply]
        {
            // reuse a stored instance_id so we hit /validate not /activate
            juce::String cachedInstanceId;
            const auto f = licenseFile();
            if (f.existsAsFile())
            {
                const auto c = juce::JSON::parse (f.loadFileAsString());
                if (c.isObject() && c.getProperty ("key", "").toString() == upper)
                    cachedInstanceId = c.getProperty ("instance_id", "").toString();
            }

            juce::DynamicObject::Ptr body = new juce::DynamicObject();
            body->setProperty ("action", "validate_license");
            body->setProperty ("key", upper);
            body->setProperty ("instance_name", "Stride on " + juce::SystemStats::getComputerName());
            if (cachedInstanceId.isNotEmpty()) body->setProperty ("instance_id", cachedInstanceId);

            int status = 0;
            juce::var parsed;
            bool networkOk = false;
            juce::URL url (kEndpoint);
            url = url.withPOSTData (juce::JSON::toString (juce::var (body.get())));
            auto opts = juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inPostData)
                          .withExtraHeaders ("Content-Type: application/json")
                          .withConnectionTimeoutMs (10000)
                          .withStatusCode (&status);
            if (auto stream = url.createInputStream (opts))
            {
                const auto resp = stream->readEntireStreamAsString();
                parsed = juce::JSON::parse (resp);
                networkOk = true;
            }

            juce::var result;
            if (networkOk && parsed.isObject() && (bool) parsed.getProperty ("valid", false))
            {
                auto* o = new juce::DynamicObject();
                o->setProperty ("valid", true);
                o->setProperty ("tier", "pro");
                o->setProperty ("customer_name",  parsed.getProperty ("customer_name", juce::var()));
                o->setProperty ("customer_email", parsed.getProperty ("customer_email", juce::var()));
                o->setProperty ("product_name",   parsed.getProperty ("product_name", juce::var()));
                o->setProperty ("instance_id",    parsed.getProperty ("instance_id", cachedInstanceId.isNotEmpty() ? juce::var (cachedInstanceId) : juce::var()));
                o->setProperty ("status", parsed.getProperty ("status", "active"));
                o->setProperty ("key", upper);
                o->setProperty ("builtin", false);
                // Product-scoping: carry the server's signed entitlements and
                // verify for THIS product (vst).
                o->setProperty ("entitlements", parsed.getProperty ("entitlements", juce::var()));
                o->setProperty ("ent",          parsed.getProperty ("ent", juce::var()));
                o->setProperty ("ent_sig",      parsed.getProperty ("ent_sig", juce::var()));
                // Take ownership in `result` FIRST. Otherwise wrapping the raw `o`
                // in a temporary var (computeEntitled(juce::var(o))) frees it when
                // that temp dies — refcount hits 0 — and every line after is a
                // use-after-free that crashes the host right after validation.
                result = juce::var (o);
                {
                    const auto e = computeEntitled (result);
                    o->setProperty ("entitled", (bool) e.getProperty ("entitled", false));
                    o->setProperty ("entitlement_reason", e.getProperty ("entitlement_reason", juce::var()));
                }
            }
            else if (networkOk)
            {
                result = invalid (parsed.isObject() ? parsed.getProperty ("error", "License key is not valid").toString()
                                                    : juce::String ("License key is not valid"));
            }
            else
            {
                // offline fallback: trust a recent cached valid result for this key
                result = invalid ("License server unreachable. Check your internet connection and try again.");
                if (f.existsAsFile())
                {
                    const auto c = juce::JSON::parse (f.loadFileAsString());
                    if (c.isObject() && c.getProperty ("key", "").toString() == upper
                          && (bool) c.getProperty ("valid", false))
                    {
                        const auto cachedAt = (juce::int64) c.getProperty ("cached_at", (juce::int64) 0);
                        const auto ageMs = juce::Time::getCurrentTime().toMilliseconds() - cachedAt;
                        if (cachedAt > 0 && ageMs < (juce::int64) kOfflineGraceDays * 24 * 60 * 60 * 1000)
                        {
                            if (auto* o = c.getDynamicObject())
                            {
                                o->setProperty ("offline", true);
                                const auto e = computeEntitled (c);
                                o->setProperty ("entitled", (bool) e.getProperty ("entitled", false));
                                o->setProperty ("entitlement_reason", e.getProperty ("entitlement_reason", juce::var()));
                                result = juce::var (o);
                            }
                        }
                    }
                }
            }

            juce::MessageManager::callAsync ([reply, result] { reply (result); });
        });
    }

    // Start (or resume) a 24-hour Discovery Pass. POSTs the email + the device hash; on success
    // returns a signed pass ent (cached by the UI so it runs offline for 24h) and raises the
    // anti-rollback clock from the unforgeable server time. Mirrors validate().
    inline void startPass (const juce::String& email, std::function<void (juce::var)> reply)
    {
        const auto em = email.trim().toLowerCase();   // OPTIONAL — the device hash is the credential + the one-pass guard

        juce::Thread::launch ([em, reply]
        {
            const auto device = deviceHash();
            juce::DynamicObject::Ptr body = new juce::DynamicObject();
            body->setProperty ("action", "start_pass");
            if (em.isNotEmpty()) body->setProperty ("email", em);   // only if the UI supplied one (lead capture)
            body->setProperty ("device", device);
            body->setProperty ("instance_name", "Stride on " + juce::SystemStats::getComputerName());

            int status = 0;
            juce::var parsed;
            bool networkOk = false;
            juce::URL url (kEndpoint);
            url = url.withPOSTData (juce::JSON::toString (juce::var (body.get())));
            auto opts = juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inPostData)
                          .withExtraHeaders ("Content-Type: application/json")
                          .withConnectionTimeoutMs (10000)
                          .withStatusCode (&status);
            if (auto stream = url.createInputStream (opts))
            {
                parsed = juce::JSON::parse (stream->readEntireStreamAsString());
                networkOk = true;
            }

            juce::var result;
            if (networkOk && parsed.isObject() && (bool) parsed.getProperty ("valid", false))
            {
                raisePassClock ((juce::int64) parsed.getProperty ("server_now_ms", (juce::int64) 0), true);   // trusted server clock

                auto* o = new juce::DynamicObject();
                o->setProperty ("valid", true);
                o->setProperty ("tier", "pass");
                o->setProperty ("key", device);            // = the signed ent.key, so computeEntitled's key-match passes
                o->setProperty ("builtin", false);
                o->setProperty ("pass", true);
                o->setProperty ("exp",     parsed.getProperty ("exp", juce::var()));
                o->setProperty ("ent",     parsed.getProperty ("ent", juce::var()));
                o->setProperty ("ent_sig", parsed.getProperty ("ent_sig", juce::var()));
                result = juce::var (o);   // OWN FIRST (avoid the use-after-free noted in validate)
                {
                    const auto e = computeEntitled (result);
                    o->setProperty ("entitled", (bool) e.getProperty ("entitled", false));
                    o->setProperty ("entitlement_reason", e.getProperty ("entitlement_reason", juce::var()));
                }
            }
            else if (networkOk)
            {
                result = invalid (parsed.isObject()
                    ? parsed.getProperty ("message", parsed.getProperty ("reason", "Could not start your pass.")).toString()
                    : juce::String ("Could not start your pass."));
            }
            else
            {
                result = invalid ("Couldn't reach the pass server. Check your internet connection and try again.");
            }

            juce::MessageManager::callAsync ([reply, result] { reply (result); });
        });
    }
}
