class Screenflow < Formula
  desc "Wrap simulator screenshots in an iPhone device frame"
  homepage "https://github.com/marvinhuelsmann/screenflow"
  url "https://github.com/marvinhuelsmann/homebrew-screenflow/archive/refs/tags/v0.2.54.tar.gz"
  sha256 "01143f14ae8ced86b719c02d51c495a58560b9ca704b33c3502fa7a167427b8e" # updated automatically by release workflow
  license "MIT"
  head "https://github.com/marvinhuelsmann/screenflow.git", branch: "master"

  depends_on "node"

  def install
    system "npm", "ci"
    zsh_completion.install "completions/_screenflow"
    fish_completion.install "completions/screenflow.fish"
    libexec.install Dir["*"]
    (bin/"screenflow").write <<~SH
      #!/bin/sh
      exec node "#{libexec}/dist/index.js" "$@"
    SH
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/screenflow --version")
  end
end
