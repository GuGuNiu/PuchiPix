import { useId } from "react";

export default function CyberpunkCityBg(): React.JSX.Element {
  const gid = useId();
  const g = (s: string): string => `${gid}-${s}`;

  return (
    <div className="cp-city-bg" aria-hidden="true">
      <svg
        viewBox="0 0 400 1200"
        preserveAspectRatio="xMidYMid slice"
        className="cp-city-svg"
      >
        <defs>
          <linearGradient id={g("bgrad")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--cp-city-building-top)" />
            <stop offset="100%" stopColor="var(--cp-city-building-btm)" />
          </linearGradient>

          <linearGradient id={g("neon-v")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--cp-city-neon)" stopOpacity="0" />
            <stop offset="50%" stopColor="var(--cp-city-neon)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--cp-city-neon)" stopOpacity="0" />
          </linearGradient>

          <filter id={g("win-glow")} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id={g("orb-blur")} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" />
          </filter>

          <linearGradient id={g("grid-fade")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--cp-city-scan)" stopOpacity="0.6" />
            <stop offset="40%" stopColor="var(--cp-city-scan)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--cp-city-scan)" stopOpacity="0" />
          </linearGradient>

          <filter id={g("particle-glow")} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="cp-city-particles">
          <circle cx="50" cy="50" r="1.2" className="cp-particle cp-pstar" />
          <circle cx="120" cy="80" r="0.8" className="cp-particle cp-pstar" />
          <circle cx="200" cy="40" r="1.5" className="cp-particle cp-pstar" />
          <circle cx="280" cy="90" r="1" className="cp-particle cp-pstar" />
          <circle cx="350" cy="60" r="1.3" className="cp-particle cp-pstar" />
          <circle cx="80" cy="120" r="0.9" className="cp-particle cp-pstar" />
          <circle cx="180" cy="110" r="1.1" className="cp-particle cp-pstar" />
          <circle cx="320" cy="130" r="0.7" className="cp-particle cp-pstar" />
          <circle cx="40" cy="160" r="1" className="cp-particle cp-pstar" />
          <circle cx="250" cy="150" r="1.4" className="cp-particle cp-pstar" />
          <circle cx="370" cy="140" r="0.8" className="cp-particle cp-pstar" />
          <circle cx="100" cy="180" r="1.2" className="cp-particle cp-pstar" />
          <circle cx="300" cy="170" r="1" className="cp-particle cp-pstar" />
          <circle cx="60" cy="210" r="0.9" className="cp-particle cp-pstar" />
          <circle cx="220" cy="200" r="1.3" className="cp-particle cp-pstar" />
          <circle cx="340" cy="220" r="0.8" className="cp-particle cp-pstar" />
        </g>

        <g className="cp-city-layer cp-city-far">
          <path d="M0,400 L0,320 L15,320 L15,300 L25,300 L25,330 L40,330 L40,290 L55,290 L55,315 L70,315 L70,280 L85,280 L85,310 L100,310 L100,295 L115,295 L115,325 L130,325 L130,305 L145,305 L145,320 L160,320 L160,285 L175,285 L175,315 L190,315 L190,300 L205,300 L205,330 L220,330 L220,290 L235,235 L235,310 L250,310 L250,295 L265,295 L265,320 L280,320 L280,305 L295,295 L295,325 L310,325 L310,300 L325,300 L325,315 L340,315 L340,285 L355,285 L355,310 L370,310 L370,295 L385,295 L385,320 L400,320 L400,400 Z" />
        </g>

        <g className="cp-city-layer cp-city-mid">
          <path d="M-10,400 L-10,310 L10,310 L10,280 L20,280 L20,320 L35,320 L35,270 L50,270 L50,300 L65,300 L65,260 L80,260 L80,310 L95,310 L95,280 L110,280 L110,320 L125,320 L125,290 L140,290 L140,310 L155,310 L155,270 L170,270 L170,300 L185,300 L185,285 L200,285 L200,315 L215,315 L215,275 L230,275 L230,305 L245,305 L245,290 L260,290 L260,320 L275,320 L275,280 L290,280 L290,300 L305,300 L305,265 L320,265 L320,310 L335,310 L335,290 L350,290 L350,315 L365,315 L365,295 L380,295 L380,325 L410,325 L410,400 Z" />
        </g>

        <g className="cp-city-layer cp-city-near">
          <path d="M-20,400 L-20,330 L5,330 L5,290 L15,290 L15,340 L30,340 L30,280 L45,280 L45,320 L60,320 L60,270 L75,270 L75,330 L90,330 L90,300 L105,300 L105,340 L120,340 L120,310 L135,310 L135,330 L150,330 L150,290 L165,290 L165,320 L180,320 L180,300 L195,300 L195,340 L210,340 L210,280 L225,280 L225,320 L240,320 L240,305 L255,305 L255,335 L270,270 L270,310 L285,310 L285,290 L300,290 L300,330 L315,330 L315,300 L330,300 L330,340 L345,340 L345,310 L360,310 L360,330 L375,330 L375,290 L390,290 L390,340 L420,340 L420,400 Z" />
        </g>

        <g className="cp-city-layer cp-city-far">
          <path d="M0,800 L0,680 L20,680 L20,660 L35,660 L35,690 L55,690 L55,650 L70,650 L70,670 L90,670 L90,640 L110,640 L110,675 L130,675 L130,655 L150,655 L150,685 L170,685 L170,660 L190,660 L190,675 L210,675 L210,635 L230,635 L230,665 L250,665 L250,680 L270,680 L270,645 L290,645 L290,670 L310,670 L310,655 L330,655 L330,685 L350,685 L350,665 L370,665 L370,690 L390,690 L390,670 L400,670 L400,800 Z" />
        </g>

        <g className="cp-city-layer cp-city-mid">
          <path d="M-10,800 L-10,700 L15,700 L15,670 L30,670 L30,710 L50,710 L50,660 L65,660 L65,685 L85,685 L85,650 L105,650 L105,690 L125,690 L125,665 L145,665 L145,705 L165,705 L165,675 L185,675 L185,690 L205,690 L205,655 L225,655 L225,680 L245,680 L245,670 L265,670 L265,695 L285,695 L285,660 L305,660 L305,685 L325,685 L325,670 L345,670 L345,700 L365,700 L365,680 L385,680 L385,710 L410,710 L410,800 Z" />
        </g>

        <g className="cp-city-layer cp-city-near">
          <path d="M-20,800 L-20,720 L10,720 L10,680 L25,680 L25,730 L45,730 L45,670 L60,670 L60,700 L80,700 L80,660 L100,660 L100,710 L120,710 L120,680 L140,680 L140,720 L160,720 L160,690 L180,690 L180,710 L200,710 L200,670 L220,670 L220,700 L240,700 L240,685 L260,685 L260,715 L280,715 L280,675 L300,675 L300,705 L320,705 L320,690 L340,690 L340,725 L360,725 L360,695 L380,695 L380,730 L420,730 L420,800 Z" />
        </g>

        <g className="cp-city-layer cp-city-far">
          <path d="M0,1200 L0,1080 L20,1080 L20,1060 L35,1060 L35,1090 L55,1090 L55,1050 L70,1050 L70,1070 L90,1070 L90,1040 L110,1040 L110,1075 L130,1075 L130,1055 L150,1055 L150,1085 L170,1085 L170,1060 L190,1060 L190,1075 L210,1075 L210,1035 L230,1035 L230,1065 L250,1065 L250,1080 L270,1080 L270,1045 L290,1045 L290,1070 L310,1070 L310,1055 L330,1055 L330,1085 L350,1085 L350,1065 L370,1065 L370,1090 L390,1090 L390,1070 L400,1070 L400,1200 Z" />
        </g>

        <g className="cp-city-layer cp-city-mid">
          <path d="M-10,1200 L-10,1100 L15,1100 L15,1070 L30,1070 L30,1110 L50,1110 L50,1060 L65,1060 L65,1085 L85,1085 L85,1050 L105,1050 L105,1090 L125,1090 L125,1065 L145,1065 L145,1105 L165,1105 L165,1075 L185,1075 L185,1090 L205,1090 L205,1055 L225,1055 L225,1080 L245,1080 L245,1070 L265,1070 L265,1095 L285,1095 L285,1060 L305,1060 L305,1085 L325,1085 L325,1070 L345,1070 L345,1100 L365,1100 L365,1080 L385,1080 L385,1110 L410,1110 L410,1200 Z" />
        </g>

        <g className="cp-city-layer cp-city-near">
          <path d="M-20,1200 L-20,1120 L10,1120 L10,1080 L25,1080 L25,1130 L45,1130 L45,1070 L60,1070 L60,1100 L80,1100 L80,1060 L100,1060 L100,1110 L120,1110 L120,1080 L140,1080 L140,1120 L160,1120 L160,1090 L180,1090 L180,1110 L200,1110 L200,1070 L220,1070 L220,1100 L240,1100 L240,1085 L260,1085 L260,1115 L280,1115 L280,1075 L300,1075 L300,1105 L320,1105 L320,1090 L340,1090 L340,1125 L360,1125 L360,1095 L380,1095 L380,1130 L420,1130 L420,1200 Z" />
        </g>

        <g className="cp-city-wires">
          <line x1="50" y1="0" x2="50" y2="1200" className="cp-wire" />
          <line x1="120" y1="0" x2="120" y2="1200" className="cp-wire" />
          <line x1="200" y1="0" x2="200" y2="1200" className="cp-wire" />
          <line x1="280" y1="0" x2="280" y2="1200" className="cp-wire" />
          <line x1="350" y1="0" x2="350" y2="1200" className="cp-wire" />
        </g>

        <g className="cp-city-bridges">
          <line x1="50" y1="400" x2="350" y2="400" className="cp-bridge" />
          <line x1="80" y1="800" x2="320" y2="800" className="cp-bridge" />
          <line x1="60" y1="600" x2="340" y2="600" className="cp-bridge cp-bridge-dim" />
          <line x1="70" y1="1000" x2="330" y2="1000" className="cp-bridge cp-bridge-dim" />
        </g>

        <g className="cp-city-neon-poles">
          <rect x="48" y="200" width="4" height="80" className="cp-neon-pole" />
          <rect x="118" y="500" width="4" height="100" className="cp-neon-pole" />
          <rect x="198" y="300" width="4" height="60" className="cp-neon-pole" />
          <rect x="278" y="700" width="4" height="90" className="cp-neon-pole" />
          <rect x="348" y="450" width="4" height="70" className="cp-neon-pole" />
        </g>

        <g className="cp-city-neon-signs">
          <text x="60" y="200" className="cp-neon-text cp-neon-text-1">PUCHI</text>
          <text x="210" y="350" className="cp-neon-text cp-neon-text-2">PIX</text>
          <text x="300" y="550" className="cp-neon-text cp-neon-text-3">2077</text>
        </g>

        <g className="cp-city-windows">
          <rect x="10" y="340" width="3" height="4" className="cp-win" />
          <rect x="16" y="340" width="3" height="4" className="cp-win" />
          <rect x="10" y="350" width="3" height="4" className="cp-win" />
          <rect x="16" y="350" width="3" height="4" className="cp-win" />
          <rect x="10" y="360" width="3" height="4" className="cp-win" />
          <rect x="16" y="360" width="3" height="4" className="cp-win" />

          <rect x="50" y="290" width="3" height="4" className="cp-win" />
          <rect x="56" y="290" width="3" height="4" className="cp-win" />
          <rect x="50" y="300" width="3" height="4" className="cp-win" />
          <rect x="56" y="300" width="3" height="4" className="cp-win" />
          <rect x="50" y="310" width="3" height="4" className="cp-win" />
          <rect x="56" y="310" width="3" height="4" className="cp-win" />

          <rect x="105" y="270" width="3" height="4" className="cp-win" />
          <rect x="111" y="270" width="3" height="4" className="cp-win" />
          <rect x="105" y="280" width="3" height="4" className="cp-win" />
          <rect x="111" y="280" width="3" height="4" className="cp-win" />
          <rect x="105" y="290" width="3" height="4" className="cp-win" />
          <rect x="111" y="290" width="3" height="4" className="cp-win" />

          <rect x="160" y="300" width="3" height="4" className="cp-win" />
          <rect x="166" y="300" width="3" height="4" className="cp-win" />
          <rect x="160" y="310" width="3" height="4" className="cp-win" />
          <rect x="166" y="310" width="3" height="4" className="cp-win" />

          <rect x="220" y="290" width="3" height="4" className="cp-win" />
          <rect x="226" y="290" width="3" height="4" className="cp-win" />
          <rect x="220" y="300" width="3" height="4" className="cp-win" />
          <rect x="226" y="300" width="3" height="4" className="cp-win" />

          <rect x="270" y="295" width="3" height="4" className="cp-win" />
          <rect x="276" y="295" width="3" height="4" className="cp-win" />
          <rect x="270" y="305" width="3" height="4" className="cp-win" />
          <rect x="276" y="305" width="3" height="4" className="cp-win" />

          <rect x="330" y="310" width="3" height="4" className="cp-win" />
          <rect x="336" y="310" width="3" height="4" className="cp-win" />
          <rect x="330" y="320" width="3" height="4" className="cp-win" />
          <rect x="336" y="320" width="3" height="4" className="cp-win" />
        </g>

        <g className="cp-city-windows">
          <rect x="10" y="740" width="3" height="4" className="cp-win" />
          <rect x="16" y="740" width="3" height="4" className="cp-win" />
          <rect x="10" y="750" width="3" height="4" className="cp-win" />
          <rect x="16" y="750" width="3" height="4" className="cp-win" />
          <rect x="10" y="760" width="3" height="4" className="cp-win" />
          <rect x="16" y="760" width="3" height="4" className="cp-win" />

          <rect x="50" y="690" width="3" height="4" className="cp-win" />
          <rect x="56" y="690" width="3" height="4" className="cp-win" />
          <rect x="50" y="700" width="3" height="4" className="cp-win" />
          <rect x="56" y="700" width="3" height="4" className="cp-win" />
          <rect x="50" y="710" width="3" height="4" className="cp-win" />
          <rect x="56" y="710" width="3" height="4" className="cp-win" />

          <rect x="105" y="670" width="3" height="4" className="cp-win" />
          <rect x="111" y="670" width="3" height="4" className="cp-win" />
          <rect x="105" y="680" width="3" height="4" className="cp-win" />
          <rect x="111" y="680" width="3" height="4" className="cp-win" />
          <rect x="105" y="690" width="3" height="4" className="cp-win" />
          <rect x="111" y="690" width="3" height="4" className="cp-win" />

          <rect x="160" y="700" width="3" height="4" className="cp-win" />
          <rect x="166" y="700" width="3" height="4" className="cp-win" />
          <rect x="160" y="710" width="3" height="4" className="cp-win" />
          <rect x="166" y="710" width="3" height="4" className="cp-win" />

          <rect x="220" y="690" width="3" height="4" className="cp-win" />
          <rect x="226" y="690" width="3" height="4" className="cp-win" />
          <rect x="220" y="700" width="3" height="4" className="cp-win" />
          <rect x="226" y="700" width="3" height="4" className="cp-win" />

          <rect x="270" y="695" width="3" height="4" className="cp-win" />
          <rect x="276" y="695" width="3" height="4" className="cp-win" />
          <rect x="270" y="705" width="3" height="4" className="cp-win" />
          <rect x="276" y="705" width="3" height="4" className="cp-win" />

          <rect x="330" y="710" width="3" height="4" className="cp-win" />
          <rect x="336" y="710" width="3" height="4" className="cp-win" />
          <rect x="330" y="720" width="3" height="4" className="cp-win" />
          <rect x="336" y="720" width="3" height="4" className="cp-win" />
        </g>

        <g className="cp-city-windows">
          <rect x="10" y="1140" width="3" height="4" className="cp-win" />
          <rect x="16" y="1140" width="3" height="4" className="cp-win" />
          <rect x="10" y="1150" width="3" height="4" className="cp-win" />
          <rect x="16" y="1150" width="3" height="4" className="cp-win" />
          <rect x="10" y="1160" width="3" height="4" className="cp-win" />
          <rect x="16" y="1160" width="3" height="4" className="cp-win" />

          <rect x="50" y="1090" width="3" height="4" className="cp-win" />
          <rect x="56" y="1090" width="3" height="4" className="cp-win" />
          <rect x="50" y="1100" width="3" height="4" className="cp-win" />
          <rect x="56" y="1100" width="3" height="4" className="cp-win" />
          <rect x="50" y="1110" width="3" height="4" className="cp-win" />
          <rect x="56" y="1110" width="3" height="4" className="cp-win" />

          <rect x="105" y="1070" width="3" height="4" className="cp-win" />
          <rect x="111" y="1070" width="3" height="4" className="cp-win" />
          <rect x="105" y="1080" width="3" height="4" className="cp-win" />
          <rect x="111" y="1080" width="3" height="4" className="cp-win" />
          <rect x="105" y="1090" width="3" height="4" className="cp-win" />
          <rect x="111" y="1090" width="3" height="4" className="cp-win" />

          <rect x="160" y="1100" width="3" height="4" className="cp-win" />
          <rect x="166" y="1100" width="3" height="4" className="cp-win" />
          <rect x="160" y="1110" width="3" height="4" className="cp-win" />
          <rect x="166" y="1110" width="3" height="4" className="cp-win" />

          <rect x="220" y="1090" width="3" height="4" className="cp-win" />
          <rect x="226" y="1090" width="3" height="4" className="cp-win" />
          <rect x="220" y="1100" width="3" height="4" className="cp-win" />
          <rect x="226" y="1100" width="3" height="4" className="cp-win" />

          <rect x="270" y="1095" width="3" height="4" className="cp-win" />
          <rect x="276" y="1095" width="3" height="4" className="cp-win" />
          <rect x="270" y="1105" width="3" height="4" className="cp-win" />
          <rect x="276" y="1105" width="3" height="4" className="cp-win" />

          <rect x="330" y="1110" width="3" height="4" className="cp-win" />
          <rect x="336" y="1110" width="3" height="4" className="cp-win" />
          <rect x="330" y="1120" width="3" height="4" className="cp-win" />
          <rect x="336" y="1120" width="3" height="4" className="cp-win" />
        </g>

        <g className="cp-city-orbs">
          <circle cx="80" cy="150" r="3" className="cp-orb cp-orb-slow" />
          <circle cx="200" cy="350" r="2.5" className="cp-orb cp-orb-medium" />
          <circle cx="320" cy="250" r="3.5" className="cp-orb cp-orb-fast" />
          <circle cx="150" cy="550" r="2" className="cp-orb cp-orb-slow" />
          <circle cx="280" cy="650" r="3" className="cp-orb cp-orb-medium" />
          <circle cx="100" cy="850" r="2.5" className="cp-orb cp-orb-fast" />
          <circle cx="350" cy="750" r="3" className="cp-orb cp-orb-slow" />
          <circle cx="180" cy="950" r="2" className="cp-orb cp-orb-medium" />
          <circle cx="300" cy="1050" r="3.5" className="cp-orb cp-orb-fast" />
          <circle cx="120" cy="1150" r="2.5" className="cp-orb cp-orb-slow" />
        </g>

        <g className="cp-city-grid">
          <line x1="0" y1="1180" x2="400" y2="1180" className="cp-grid-line" />
          <line x1="0" y1="1190" x2="400" y2="1190" className="cp-grid-line" />
          <line x1="0" y1="1200" x2="400" y2="1200" className="cp-grid-line" />
          <line x1="50" y1="1150" x2="50" y2="1200" className="cp-grid-line" />
          <line x1="100" y1="1150" x2="100" y2="1200" className="cp-grid-line" />
          <line x1="150" y1="1150" x2="150" y2="1200" className="cp-grid-line" />
          <line x1="200" y1="1150" x2="200" y2="1200" className="cp-grid-line" />
          <line x1="250" y1="1150" x2="250" y2="1200" className="cp-grid-line" />
          <line x1="300" y1="1150" x2="300" y2="1200" className="cp-grid-line" />
          <line x1="350" y1="1150" x2="350" y2="1200" className="cp-grid-line" />
        </g>

        <line x1="0" y1="0" x2="0" y2="1200" className="cp-scan-line-v" />
      </svg>
    </div>
  );
}
