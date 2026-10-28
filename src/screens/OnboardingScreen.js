import React, {useRef, useState} from 'react';
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {colors, spacing} from '../theme';

// Welcome slide colours, matched to the Atiya Herbs welcome design
const WELCOME_GREEN = '#125A35';
const WELCOME_GREY = '#5F6A62';

const SLIDES = [
  {
    id: '1',
    image: require('../assets/images/banner1.jpg'),
    icon: 'leaf',
    title: 'Authentic Unani &\nAyurvedic Remedies',
    text: 'Time-tested formulations by Hakim Suleman Khan, made with pure, natural herbs.',
  },
  {id: '2', welcome: true},
];

function WelcomeSlide({width}) {
  return (
    <View style={[styles.welcome, {width}]}>
      <View style={styles.welcomeLogoCircle}>
        <Image
          source={require('../assets/images/logo.png')}
          style={styles.welcomeLogo}
          resizeMode="contain"
          accessibilityLabel="Atiya Herbs logo"
        />
      </View>
      <Text style={styles.welcomeTitle}>Atiya Herbs</Text>
      <Text style={styles.welcomeText}>
        Authentic Ayurvedic & Unani{'\n'}remedies by Hakim Suleman Khan
      </Text>
    </View>
  );
}

export default function OnboardingScreen({navigation}) {
  const {width, height} = useWindowDimensions();
  const scrollX = useRef(new Animated.Value(0)).current;
  const listRef = useRef(null);
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  const next = () => listRef.current?.scrollToIndex({index: index + 1, animated: true});

  return (
    <View style={styles.container}>
      <Animated.FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={item => item.id}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={Animated.event([{nativeEvent: {contentOffset: {x: scrollX}}}], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
        onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({item, index: i}) => {
          if (item.welcome) {
            return <WelcomeSlide width={width} />;
          }
          // Image drifts slower than the page for a soft parallax effect
          const translateX = scrollX.interpolate({
            inputRange: [(i - 1) * width, i * width, (i + 1) * width],
            outputRange: [-width * 0.25, 0, width * 0.25],
          });
          return (
            <View style={{width}}>
              <View style={[styles.imageWrap, {height: height * 0.56}]}>
                <Animated.View style={[StyleSheet.absoluteFill, {transform: [{translateX}]}]}>
                  <Image source={item.image} style={styles.image} resizeMode="cover" />
                </Animated.View>
                <View style={styles.imageShade} />
              </View>
              <View style={styles.textBlock}>
                <View style={styles.iconCircle}>
                  <Icon name={item.icon} size={26} color={colors.primary} />
                </View>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.text}>{item.text}</Text>
              </View>
            </View>
          );
        }}
      />

      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        {!isLast && (
          <Pressable style={styles.skip} onPress={() => navigation.replace('Login')} hitSlop={10}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        )}
      </SafeAreaView>

      <SafeAreaView style={styles.footer} edges={['bottom']}>
        {isLast ? (
          <>
            <Pressable style={styles.welcomeButton} onPress={() => navigation.replace('SignUp')}>
              <Text style={styles.welcomeButtonText}>Let's get started</Text>
            </Pressable>
            <Pressable
              style={styles.accountRow}
              onPress={() => navigation.replace('Login')}
              accessibilityRole="button"
              accessibilityLabel="I already have an account, log in">
              <Text style={styles.accountText}>I already have an account</Text>
              <View style={styles.accountArrow}>
                <Icon name="arrow-right" size={22} color="#fff" />
              </View>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.dots}>
              {SLIDES.map((_, i) => {
                const scale = scrollX.interpolate({
                  inputRange: [(i - 1) * width, i * width, (i + 1) * width],
                  outputRange: [1, 3, 1],
                  extrapolate: 'clamp',
                });
                const opacity = scrollX.interpolate({
                  inputRange: [(i - 1) * width, i * width, (i + 1) * width],
                  outputRange: [0.35, 1, 0.35],
                  extrapolate: 'clamp',
                });
                return (
                  <Animated.View key={i} style={[styles.dot, {opacity, transform: [{scaleX: scale}]}]} />
                );
              })}
            </View>
            <Pressable style={styles.button} onPress={next}>
              <Text style={styles.buttonText}>Next</Text>
              <Icon name="arrow-right" size={20} color="#fff" />
            </Pressable>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  imageWrap: {
    overflow: 'hidden',
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    backgroundColor: colors.primaryLight,
  },
  image: {width: '100%', height: '100%'},
  imageShade: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,83,45,0.12)'},
  textBlock: {paddingHorizontal: spacing.lg, alignItems: 'center', marginTop: -30},
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.primaryLight,
    marginBottom: spacing.md,
  },
  title: {fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center', lineHeight: 31},
  text: {fontSize: 15, color: colors.muted, textAlign: 'center', marginTop: 10, lineHeight: 22},
  welcome: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: 40,
  },
  welcomeLogoCircle: {
    width: 154,
    height: 154,
    borderRadius: 77,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
  },
  // Fixed size: Android ignores aspectRatio on images
  welcomeLogo: {width: 120, height: 39},
  welcomeTitle: {
    fontFamily: 'Poppins-Bold',
    fontSize: 50,
    lineHeight: 64,
    color: WELCOME_GREEN,
    textAlign: 'center',
  },
  welcomeText: {
    fontFamily: 'Poppins-Regular',
    fontSize: 17,
    lineHeight: 26,
    color: WELCOME_GREY,
    textAlign: 'center',
    marginTop: 8,
  },
  topBar: {position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'flex-end'},
  skip: {
    marginTop: 8,
    marginRight: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 18,
  },
  skipText: {color: colors.primary, fontWeight: '700', fontSize: 14},
  footer: {paddingHorizontal: spacing.lg, paddingBottom: spacing.md},
  dots: {flexDirection: 'row', justifyContent: 'center', marginBottom: spacing.lg},
  dot: {width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginHorizontal: 8},
  button: {
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {color: '#fff', fontWeight: '800', fontSize: 17, marginRight: 8},
  welcomeButton: {
    height: 60,
    borderRadius: 12,
    backgroundColor: WELCOME_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeButtonText: {fontFamily: 'Poppins-SemiBold', fontSize: 18, color: '#fff'},
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    marginBottom: 4,
  },
  accountText: {fontFamily: 'Poppins-Regular', fontSize: 16, color: WELCOME_GREY},
  accountArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: WELCOME_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 14,
  },
});
