class Screenflow < Formula
  desc "Wrap simulator screenshots in an iPhone device frame"
  homepage "https://github.com/marvinhuelsmann/screenflow"
  url "https://github.com/marvinhuelsmann/homebrew-screenflow/archive/refs/tags/v0.2.52.tar.gz"
  sha256 "c20292425d6eeb89fd840ed722b48260c34d390370080ce674560189d1668776" # updated automatically by release workflow
  license "MIT"
  head "https://github.com/marvinhuelsmann/screenflow.git", branch: "master"

  depends_on "node"

  def install
    system "npm", "ci"
    libexec.install Dir["*"]
    (bin/"screenflow").write <<~SH
      #!/bin/sh
      exec node "#{libexec}/dist/index.js" "$@"
    SH
    zsh_completion.install libexec/"completions/_screenflow"
    fish_completion.install libexec/"completions/screenflow.fish"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/screenflow --version")
  end
end
