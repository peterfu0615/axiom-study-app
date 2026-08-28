use std::iter::Peekable;
use std::str::Chars;

pub fn latex_to_typst(input: &str) -> Result<String, String> {
    let mut parser = Parser::new(input);
    let output = parser.parse_until(None)?;
    if output.contains('\0') {
        return Err("公式包含无效字符".to_string());
    }
    Ok(normalize_identifier_runs(
        &output.split_whitespace().collect::<Vec<_>>().join(" "),
    ))
}

fn normalize_identifier_runs(value: &str) -> String {
    const TYPST_WORDS: &[&str] = &[
        "angle",
        "triangle",
        "perp",
        "parallel",
        "degree",
        "because",
        "therefore",
        "approx",
        "times",
        "div",
        "plus",
        "minus",
        "dot",
        "infinity",
        "frac",
        "sqrt",
        "cases",
        "bold",
        "italic",
        "sans",
        "mono",
        "upright",
        "overline",
        "underline",
        "arrow",
        "op",
        "sum",
        "prod",
        "int",
        "lim",
        "sin",
        "cos",
        "tan",
        "log",
        "ln",
        "min",
        "max",
        "det",
        "gcd",
        "alpha",
        "beta",
        "gamma",
        "delta",
        "epsilon",
        "varepsilon",
        "zeta",
        "eta",
        "theta",
        "vartheta",
        "iota",
        "kappa",
        "lambda",
        "mu",
        "nu",
        "xi",
        "pi",
        "varpi",
        "rho",
        "varrho",
        "sigma",
        "varsigma",
        "tau",
        "upsilon",
        "phi",
        "varphi",
        "chi",
        "psi",
        "omega",
    ];
    let characters: Vec<char> = value.chars().collect();
    let mut output = String::new();
    let mut index = 0usize;
    let mut in_string = false;
    while index < characters.len() {
        let character = characters[index];
        if character == '"' && (index == 0 || characters[index - 1] != '\\') {
            in_string = !in_string;
            output.push(character);
            index += 1;
            continue;
        }
        if !in_string && character.is_ascii_alphabetic() {
            let start = index;
            while index < characters.len() && characters[index].is_ascii_alphabetic() {
                index += 1;
            }
            let word: String = characters[start..index].iter().collect();
            if word.len() > 1 && !TYPST_WORDS.contains(&word.as_str()) {
                output.push_str(
                    &word
                        .chars()
                        .map(|value| value.to_string())
                        .collect::<Vec<_>>()
                        .join(" "),
                );
            } else {
                output.push_str(&word);
            }
            continue;
        }
        output.push(character);
        index += 1;
    }
    output
}

struct Parser<'a> {
    chars: Peekable<Chars<'a>>,
}

impl Parser<'_> {
    fn new(input: &str) -> Parser<'_> {
        Parser {
            chars: input.chars().peekable(),
        }
    }

    fn parse_until(&mut self, terminator: Option<char>) -> Result<String, String> {
        let mut output = String::new();
        while let Some(character) = self.chars.next() {
            if Some(character) == terminator {
                return Ok(output);
            }
            match character {
                '\\' => output.push_str(&self.command()?),
                '{' => {
                    let group = self.parse_until(Some('}'))?;
                    output.push('(');
                    output.push_str(&group);
                    output.push(')');
                }
                '}' => return Err("公式包含未配对的右花括号".to_string()),
                '$' => {}
                '&' => output.push_str(" & "),
                '~' => output.push(' '),
                _ => output.push(character),
            }
        }
        if terminator.is_some() {
            Err("公式包含未闭合的花括号".to_string())
        } else {
            Ok(output)
        }
    }

    fn command(&mut self) -> Result<String, String> {
        if self.chars.peek() == Some(&'\\') {
            self.chars.next();
            return Ok(" \\\\ ".to_string());
        }
        let mut name = String::new();
        while self
            .chars
            .peek()
            .is_some_and(|character| character.is_ascii_alphabetic())
        {
            name.push(self.chars.next().expect("peeked character"));
        }
        if name.is_empty() {
            return match self.chars.next() {
                Some(character @ ('{' | '}' | '%' | '#' | '_' | '&' | '$')) => {
                    Ok(character.to_string())
                }
                Some(',') | Some(';') | Some('!') | Some(' ') => Ok(" ".to_string()),
                Some(character) => Err(format!("不支持的 LaTeX 转义：\\{character}")),
                None => Err("公式以孤立反斜杠结尾".to_string()),
            };
        }

        match name.as_str() {
            "frac" | "dfrac" | "tfrac" => {
                let numerator = self.required_group(&name)?;
                let denominator = self.required_group(&name)?;
                Ok(math_token(format!("frac({numerator}, {denominator})")))
            }
            "sqrt" => {
                let radicand = self.required_group(&name)?;
                Ok(math_token(format!("sqrt({radicand})")))
            }
            "text" | "textrm" | "textnormal" => {
                let value = self.required_raw_group(&name)?;
                Ok(math_token(typst_math_string(&value)))
            }
            "mathrm" | "mathbf" | "mathit" | "mathsf" | "mathtt" => {
                let value = self.required_group(&name)?;
                let function = match name.as_str() {
                    "mathbf" => "bold",
                    "mathit" => "italic",
                    "mathsf" => "sans",
                    "mathtt" => "mono",
                    _ => "upright",
                };
                Ok(math_token(format!("{function}({value})")))
            }
            "overline" | "bar" => Ok(math_token(format!(
                "overline({})",
                self.required_group(&name)?
            ))),
            "underline" => Ok(math_token(format!(
                "underline({})",
                self.required_group(&name)?
            ))),
            "vec" | "overrightarrow" => Ok(math_token(format!(
                "arrow({})",
                self.required_group(&name)?
            ))),
            "operatorname" => {
                let value = self.required_raw_group(&name)?;
                Ok(math_token(format!("op({})", typst_math_string(&value))))
            }
            "left" | "right" => Ok(String::new()),
            "quad" | "qquad" | "enspace" | "thinspace" => Ok(" ".to_string()),
            "angle" => Ok(math_token("angle")),
            "triangle" => Ok(math_token("triangle")),
            "perp" => Ok(math_token("perp")),
            "parallel" => Ok(math_token("parallel")),
            "circ" => Ok(math_token("degree")),
            "because" => Ok(math_token("because")),
            "therefore" => Ok(math_token("therefore")),
            "Longrightarrow" => Ok(math_token("==>")),
            "Longleftarrow" => Ok(math_token("<==")),
            "Leftrightarrow" | "Longleftrightarrow" => Ok(math_token("<==>")),
            "Rightarrow" | "rightarrow" | "to" | "implies" => Ok(math_token("=>")),
            "Leftarrow" | "leftarrow" | "impliedby" => Ok(math_token("<=")),
            "geq" | "ge" => Ok(math_token(">=")),
            "leq" | "le" => Ok(math_token("<=")),
            "neq" | "ne" => Ok(math_token("!=")),
            "approx" => Ok(math_token("approx")),
            "times" => Ok(math_token("times")),
            "cdot" => Ok(math_token("dot.c")),
            "div" => Ok(math_token("div")),
            "pm" => Ok(math_token("plus.minus")),
            "mp" => Ok(math_token("minus.plus")),
            "infty" => Ok(math_token("infinity")),
            "sum" | "prod" | "int" | "lim" | "sin" | "cos" | "tan" | "log" | "ln" | "min"
            | "max" | "det" | "gcd" => Ok(math_token(name)),
            "alpha" | "beta" | "gamma" | "delta" | "epsilon" | "varepsilon" | "zeta" | "eta"
            | "theta" | "vartheta" | "iota" | "kappa" | "lambda" | "mu" | "nu" | "xi" | "pi"
            | "varpi" | "rho" | "varrho" | "sigma" | "varsigma" | "tau" | "upsilon" | "phi"
            | "varphi" | "chi" | "psi" | "omega" | "Gamma" | "Delta" | "Theta" | "Lambda"
            | "Xi" | "Pi" | "Sigma" | "Upsilon" | "Phi" | "Psi" | "Omega" => {
                Ok(math_token(name.to_ascii_lowercase()))
            }
            "begin" => {
                let environment = self.required_raw_group(&name)?;
                match environment.as_str() {
                    "cases" => self.parse_cases_environment().map(math_token),
                    _ => Err(format!("公式暂不支持 LaTeX 环境 \\begin{{{environment}}}")),
                }
            }
            "end" => Err("公式包含未匹配的 LaTeX 环境结束命令 \\end".to_string()),
            _ => Err(format!("不支持的 LaTeX 命令：\\{name}")),
        }
    }

    fn parse_cases_environment(&mut self) -> Result<String, String> {
        let mut body = String::new();
        let mut brace_depth = 0usize;
        loop {
            let Some(character) = self.chars.next() else {
                return Err("LaTeX cases 环境缺少 \\end{cases}".to_string());
            };

            match character {
                '{' => {
                    brace_depth += 1;
                    body.push(character);
                }
                '}' => {
                    brace_depth = brace_depth.saturating_sub(1);
                    body.push(character);
                }
                '\\' if brace_depth == 0 => {
                    let mut command = String::new();
                    while self
                        .chars
                        .peek()
                        .is_some_and(|value| value.is_ascii_alphabetic())
                    {
                        command.push(self.chars.next().expect("peeked character"));
                    }
                    if command == "end" {
                        let closing = self.required_raw_group("end")?;
                        if closing == "cases" {
                            return self.render_cases_rows(&body);
                        }
                        body.push_str("\\end{");
                        body.push_str(&closing);
                        body.push('}');
                    } else {
                        body.push('\\');
                        body.push_str(&command);
                    }
                }
                _ => body.push(character),
            }
        }
    }

    fn render_cases_rows(&self, body: &str) -> Result<String, String> {
        let rows = body
            .split("\\\\")
            .map(str::trim)
            .filter(|row| !row.is_empty())
            .map(|row| {
                let mut parser = Parser::new(row);
                parser.parse_until(None)
            })
            .collect::<Result<Vec<_>, _>>()?;
        if rows.is_empty() {
            return Err("LaTeX cases 环境不包含有效行".to_string());
        }
        Ok(format!("cases({})", rows.join(", ")))
    }

    fn required_group(&mut self, command: &str) -> Result<String, String> {
        self.skip_spaces();
        if self.chars.next() != Some('{') {
            return Err(format!("LaTeX 命令 \\{command} 缺少花括号参数"));
        }
        self.parse_until(Some('}'))
    }

    fn required_raw_group(&mut self, command: &str) -> Result<String, String> {
        self.skip_spaces();
        if self.chars.next() != Some('{') {
            return Err(format!("LaTeX 命令 \\{command} 缺少花括号参数"));
        }
        let mut depth = 1usize;
        let mut output = String::new();
        for character in self.chars.by_ref() {
            match character {
                '{' => {
                    depth += 1;
                    output.push(character);
                }
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok(output);
                    }
                    output.push(character);
                }
                _ => output.push(character),
            }
        }
        Err(format!("LaTeX 命令 \\{command} 的参数未闭合"))
    }

    fn skip_spaces(&mut self) {
        while self
            .chars
            .peek()
            .is_some_and(|character| character.is_whitespace())
        {
            self.chars.next();
        }
    }
}

fn typst_math_string(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', " ")
    )
}

fn math_token(value: impl AsRef<str>) -> String {
    format!(" {} ", value.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_required_regression_formulas_to_typst_math() {
        let cases = [
            ("y=(3m+1)x-2", "y=(3m+1)x-2"),
            (r"\angle ABC", "angle A B C"),
            (r"AC \perp BD", "A C perp B D"),
            (r"\frac{1}{2}", "frac(1, 2)"),
            (r"180^\circ", "180^ degree"),
            (r"\sqrt{3}", "sqrt(3)"),
            ("x^2+2x+1", "x^2+2x+1"),
        ];
        for (latex, expected) in cases {
            assert_eq!(latex_to_typst(latex).unwrap(), expected);
        }
    }

    #[test]
    fn converts_nested_fractions_text_and_reasoning_symbols() {
        assert_eq!(
            latex_to_typst(r"\because m>-\frac{\sqrt{3}}{2}\therefore \text{成立}").unwrap(),
            r#"because m>- frac( sqrt(3) , 2) therefore "成立""#
        );
    }

    #[test]
    fn separates_adjacent_measurement_symbols_from_numbers() {
        assert_eq!(
            latex_to_typst(r"2410\pm40^\circ\text{C}").unwrap(),
            r#"2410 plus.minus 40^ degree "C""#
        );
        assert_eq!(latex_to_typst(r"2\pi r").unwrap(), "2 pi r");
    }

    #[test]
    fn converts_cases_environment_without_leaking_latex_commands() {
        let converted =
            latex_to_typst(r"\therefore \begin{cases} -2k + b = 0 \\ b = 4 \end{cases}").unwrap();
        assert_eq!(converted, "therefore cases(-2k + b = 0, b = 4)");
        assert!(!converted.contains("begin"));
        assert!(!converted.contains("end"));
    }

    #[test]
    fn parses_math_commands_inside_cases_rows() {
        assert_eq!(
            latex_to_typst(r"\begin{cases} x=\frac{1}{2} \\ y=\sqrt{3} \end{cases}").unwrap(),
            "cases(x= frac(1, 2) , y= sqrt(3) )"
        );
    }

    #[test]
    fn rejects_malformed_or_unknown_environments_without_plain_text_fallback() {
        let missing_end = latex_to_typst(r"\begin{cases} x=1").unwrap_err();
        assert!(missing_end.contains("缺少"));
        let unknown = latex_to_typst(r"\begin{aligned} x&=1 \end{aligned}").unwrap_err();
        assert!(unknown.contains("aligned"));
        assert!(!unknown.contains("typst"));
    }

    #[test]
    fn rejects_unknown_commands_instead_of_leaking_plain_latex() {
        let error = latex_to_typst(r"x \unsupported y").unwrap_err();
        assert!(error.contains(r"\unsupported"));
        assert!(!error.contains("typst"));
    }
}
