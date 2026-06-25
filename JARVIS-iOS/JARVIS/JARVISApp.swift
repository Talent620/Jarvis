import SwiftUI

@main
struct JARVISApp: App {
    @StateObject private var store = AppStore()
    @StateObject private var assistant = Assistant()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(assistant)
                .preferredColorScheme(.dark)
                .tint(Theme.cyan)
                .onAppear { assistant.attach(store: store) }
        }
    }
}
