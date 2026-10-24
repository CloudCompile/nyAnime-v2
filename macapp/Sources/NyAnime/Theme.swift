import SwiftUI

/// Design tokens mirroring the web app's Tailwind theme (tailwind.config.ts).
/// Centralising them here keeps the native port visually in step with
/// nyanime.cjhauser.me without sprinkling magic numbers across views.
extension Color {
    static let animeDarker  = Color(red: 0.051, green: 0.051, blue: 0.082)   // #0D0D15
    static let animeDark     = Color(red: 0.078, green: 0.078, blue: 0.125)  // #141420
    static let animeGray     = Color(red: 0.110, green: 0.110, blue: 0.149)  // #1C1C26
    static let animePurple   = Color(red: 0.545, green: 0.361, blue: 0.965)  // #8B5CF6
    static let animePink     = Color(red: 0.851, green: 0.275, blue: 0.937)  // #D946EF
    static let animeBlue     = Color(red: 0.055, green: 0.647, blue: 0.914)  // #0EA5E9
}

extension View {
    /// Apply the site's standard dark surface background.
    func animeBackground() -> some View {
        self.background(Color.animeDarker)
    }
}