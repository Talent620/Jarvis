import UIKit
import Capacitor
import CryptoKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // License gate: if licensing is enabled (a public key is embedded) and the
        // device is not yet activated, show the activation screen INSTEAD of loading
        // the web app. The WebView is created only after a valid key is entered.
        if !LicenseManager.shared.isLicensed {
            let gate = LicenseGateViewController()
            gate.onActivated = { [weak self] in
                let sb = UIStoryboard(name: "Main", bundle: nil)
                self?.window?.rootViewController = sb.instantiateInitialViewController()
            }
            if window == nil { window = UIWindow(frame: UIScreen.main.bounds) }
            window?.rootViewController = gate
            window?.makeKeyAndVisible()
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

// MARK: - License configuration
//
// The public key (Ed25519, raw 32 bytes, base64) is injected here by
// `npm run license:genkeys`. While it is empty, licensing is DISABLED and the app
// runs normally — so the project keeps building before you set up keys.
enum LicenseConfig {
    static let publicKeyBase64 = "" // JARVIS_LICENSE_PUBLIC_KEY
}

// MARK: - License manager (offline Ed25519 verification)

final class LicenseManager {
    static let shared = LicenseManager()
    private let storeKey = "jarvis.license"

    /// Licensing is "off" until a public key is embedded — keeps default builds working.
    var isEnabled: Bool { !LicenseConfig.publicKeyBase64.isEmpty }

    var isLicensed: Bool {
        guard isEnabled else { return true }
        if let token = UserDefaults.standard.string(forKey: storeKey), verify(token) { return true }
        return false
    }

    /// Validate and persist a license token. Returns true on success.
    @discardableResult
    func activate(_ token: String) -> Bool {
        let t = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard verify(t) else { return false }
        UserDefaults.standard.set(t, forKey: storeKey)
        return true
    }

    func deactivate() { UserDefaults.standard.removeObject(forKey: storeKey) }

    /// Token format: base64url(payloadJSON) + "." + base64url(signature).
    /// payloadJSON = {"n":<name>,"exp":<unix seconds, 0 = lifetime>,"f":[features]}
    func verify(_ token: String) -> Bool {
        let parts = token.split(separator: ".")
        guard parts.count == 2,
              let payload = Data(base64URLEncoded: String(parts[0])),
              let sig = Data(base64URLEncoded: String(parts[1])),
              let pubData = Data(base64Encoded: LicenseConfig.publicKeyBase64),
              let pub = try? Curve25519.Signing.PublicKey(rawRepresentation: pubData),
              pub.isValidSignature(sig, for: payload)
        else { return false }

        // Optional expiry check.
        if let p = try? JSONDecoder().decode(LicensePayload.self, from: payload),
           let exp = p.exp, exp > 0,
           Date().timeIntervalSince1970 > exp {
            return false
        }
        return true
    }

    func info(_ token: String) -> LicensePayload? {
        let parts = token.split(separator: ".")
        guard let first = parts.first, let payload = Data(base64URLEncoded: String(first)) else { return nil }
        return try? JSONDecoder().decode(LicensePayload.self, from: payload)
    }
}

struct LicensePayload: Decodable {
    let n: String?      // name / owner
    let exp: Double?    // expiry (unix seconds), 0 or nil = lifetime
    let f: [String]?    // features
}

// MARK: - base64url helper

extension Data {
    init?(base64URLEncoded s: String) {
        var str = s.replacingOccurrences(of: "-", with: "+")
                   .replacingOccurrences(of: "_", with: "/")
        while str.count % 4 != 0 { str.append("=") }
        guard let d = Data(base64Encoded: str) else { return nil }
        self = d
    }
}

// MARK: - License activation screen (HUD style)

final class LicenseGateViewController: UIViewController {
    var onActivated: (() -> Void)?

    private let field = UITextView()
    private let error = UILabel()
    private let bg = UIColor(red: 0.016, green: 0.027, blue: 0.059, alpha: 1) // #04070f
    private let cyan = UIColor(red: 0.290, green: 0.886, blue: 0.953, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = bg

        let title = UILabel()
        title.text = "J.A.R.V.I.S"
        title.font = .monospacedSystemFont(ofSize: 28, weight: .black)
        title.textColor = cyan
        title.textAlignment = .center

        let subtitle = UILabel()
        subtitle.text = "Aktywacja — wklej klucz licencyjny"
        subtitle.font = .systemFont(ofSize: 15, weight: .medium)
        subtitle.textColor = UIColor(white: 0.7, alpha: 1)
        subtitle.textAlignment = .center
        subtitle.numberOfLines = 0

        field.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        field.textColor = .white
        field.backgroundColor = UIColor(white: 1, alpha: 0.06)
        field.layer.cornerRadius = 12
        field.layer.borderWidth = 1
        field.layer.borderColor = cyan.withAlphaComponent(0.4).cgColor
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.textContainerInset = UIEdgeInsets(top: 12, left: 10, bottom: 12, right: 10)

        error.font = .systemFont(ofSize: 13, weight: .medium)
        error.textColor = UIColor(red: 1, green: 0.42, blue: 0.42, alpha: 1)
        error.textAlignment = .center
        error.numberOfLines = 0

        let activate = UIButton(type: .system)
        activate.setTitle("Aktywuj", for: .normal)
        activate.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        activate.setTitleColor(bg, for: .normal)
        activate.backgroundColor = cyan
        activate.layer.cornerRadius = 14
        activate.addTarget(self, action: #selector(activateTapped), for: .touchUpInside)
        activate.heightAnchor.constraint(equalToConstant: 50).isActive = true

        let paste = UIButton(type: .system)
        paste.setTitle("Wklej ze schowka", for: .normal)
        paste.titleLabel?.font = .systemFont(ofSize: 14)
        paste.setTitleColor(cyan, for: .normal)
        paste.addTarget(self, action: #selector(pasteTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, subtitle, field, paste, activate, error])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor, constant: -8),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            field.heightAnchor.constraint(equalToConstant: 120)
        ])
    }

    @objc private func pasteTapped() {
        field.text = UIPasteboard.general.string ?? field.text
    }

    @objc private func activateTapped() {
        view.endEditing(true)
        if LicenseManager.shared.activate(field.text ?? "") {
            onActivated?()
        } else {
            error.text = "Nieprawidłowy lub wygasły klucz licencyjny."
        }
    }
}
