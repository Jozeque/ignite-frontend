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

    inline juce::String shaUpper (const juce::String& key)
    {
        const auto u = key.trim().toUpperCase();
        return juce::SHA256 (u.toRawUTF8(), (size_t) u.getNumBytesAsUTF8()).toHexString();
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
                return juce::var (o);
            }
        return {};
    }

    // {success:true, license:<obj|null>}
    inline juce::var load()
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("success", true);
        const auto f = licenseFile();
        if (f.existsAsFile())
        {
            const auto parsed = juce::JSON::parse (f.loadFileAsString());
            o->setProperty ("license", parsed.isObject() ? parsed : juce::var());
        }
        else o->setProperty ("license", juce::var());
        return juce::var (o);
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
                result = juce::var (o);
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
                                result = juce::var (o);
                            }
                        }
                    }
                }
            }

            juce::MessageManager::callAsync ([reply, result] { reply (result); });
        });
    }
}
