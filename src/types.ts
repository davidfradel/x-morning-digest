// --- Twitter API (twitterapi.io) response shapes ---

export interface TwitterApiAuthor {
  id: string;
  userName: string;
  name: string;
  profilePicture: string;
  isVerified?: boolean;
}

export interface TwitterApiTweet {
  id: string;
  text: string;
  createdAt: string;
  author: TwitterApiAuthor;
  isRetweet: boolean;
  isQuoted?: boolean;
  inReplyToId?: string | null;
  conversationId?: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount?: number;
  media?: { type: string; url: string }[];
  entities?: {
    urls?: { display_url: string; expanded_url: string; url: string }[];
    hashtags?: { text: string }[];
    mentions?: { username: string }[];
  };
}

export interface TwitterApiSearchResponse {
  tweets: TwitterApiTweet[];
  has_next_page: boolean;
  next_cursor?: string;
}

export interface TwitterApiFollowing {
  id: string;
  userName: string;
  name: string;
  profilePicture: string;
  description?: string;
  followers?: number;
  following?: number;
}

export interface TwitterApiFollowingsResponse {
  followings: TwitterApiFollowing[];
  has_next_page: boolean;
  next_cursor?: string;
}

// --- Internal domain types ---

export interface TweetStats {
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views: number;
}

export interface Tweet {
  id: string;
  text: string;
  createdAt: Date;
  authorUsername: string;
  authorName: string;
  authorAvatar: string;
  isRetweet: boolean;
  conversationId: string;
  inReplyToId: string | null;
  stats: TweetStats;
  score: number;
  url: string;
}

export interface Thread {
  authorUsername: string;
  authorName: string;
  authorAvatar: string;
  tweets: Tweet[];
  totalTweets: number;
  firstTweet: Tweet;
  url: string;
}

export interface DigestData {
  date: string;
  virals: Tweet[];
  threads: Thread[];
  totalTweetsFetched: number;
  accountsChecked: number;
}
